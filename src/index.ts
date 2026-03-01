import express from 'express';
import cors from 'cors';
import { createLogger } from './lib/logger.js';
import { Redactor } from './middleware/redactor.js';
import { TokenVault } from './vault/token-vault.js';

const log = createLogger('hush-proxy');
const redactor = new Redactor();
const vault = new TokenVault();

export const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

/**
 * Helper to handle proxying with optional streaming
 */
async function proxyRequest(
  req: express.Request,
  res: express.Response,
  targetUrl: string,
  headers: Record<string, string>
) {
  // 1. Redact Request Body (Prompts, Tool Results)
  const { content: redactedBody, tokens, hasRedacted } = redactor.redact(req.body);
  
  if (hasRedacted) {
    log.info({ path: req.path, tokenCount: tokens.size }, 'Redacted sensitive data from request');
    vault.saveTokens(tokens);
  }

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(redactedBody),
      signal: AbortSignal.timeout(30000), // 30s timeout
    });

    // Handle Upstream Errors (4xx, 5xx)
    if (!response.ok) {
      log.error({ status: response.status, path: req.path }, 'Upstream provider returned an error');
      const errorData = await response.text();
      return res.status(response.status).send(errorData);
    }

    // Case A: Streaming
    if (req.body.stream && response.body) {
      log.info({ path: req.path }, 'Starting stream proxy');
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          
          // Process full lines (SSE events)
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; 

          for (const line of lines) {
            if (line.trim()) {
              const rehydratedLine = vault.rehydrate(line);
              const canWrite = res.write(rehydratedLine + '\n');
              // Handle backpressure
              if (!canWrite) {
                await new Promise((resolve) => res.once('drain', resolve));
              }
            } else {
              res.write('\n');
            }
          }
        }
        // Process remaining buffer
        if (buffer) {
          res.write(vault.rehydrate(buffer));
        }
      } finally {
        reader.releaseLock();
      }
      res.end();
      return;
    }

    // Case B: Regular JSON
    const data = await response.json();
    const rehydratedData = vault.rehydrate(data);
    res.status(response.status).json(rehydratedData);

  } catch (error) {
    log.error({ err: error, path: req.path }, 'Failed to forward request');
    res.status(500).json({ error: 'Gateway forwarding failed' });
  }
}

/**
 * Handle Anthropic /messages proxy
 */
app.post('/v1/messages', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing Anthropic API Key' });

  await proxyRequest(req, res, 'https://api.anthropic.com/v1/messages', {
    'x-api-key': apiKey as string,
    'anthropic-version': req.headers['anthropic-version'] as string || '2023-06-01',
  });
});

/**
 * Handle OpenAI /chat/completions proxy
 */
app.post('/v1/chat/completions', async (req, res) => {
  const auth = req.headers['authorization'];
  if (!auth) return res.status(401).json({ error: 'Missing OpenAI Authorization' });

  await proxyRequest(req, res, 'https://api.openai.com/v1/chat/completions', {
    'Authorization': auth as string,
  });
});

// Health check
app.get('/health', (req, res) => {
  const response: any = { status: 'running' };
  if (process.env.DEBUG === 'true') {
    response.vaultSize = vault.size;
  }
  res.json(response);
});
