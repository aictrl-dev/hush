import express from 'express';
import cors from 'cors';
import { createLogger } from './lib/logger.js';
import { Redactor } from './middleware/redactor.js';
import { TokenVault } from './vault/token-vault.js';
import { Dashboard } from './lib/dashboard.js';

const log = createLogger('hush-proxy');
const redactor = new Redactor();
const vault = new TokenVault();

// Lazy-initialize dashboard to ensure it captures flags set by CLI or ENV
let _dashboard: Dashboard | null = null;
function getDashboard(): Dashboard | null {
  if (_dashboard) return _dashboard;
  if (process.env.HUSH_DASHBOARD === 'true' || process.argv.includes('--dashboard')) {
    _dashboard = new Dashboard();
  }
  return _dashboard;
}

// Force immediate initialization if dashboard flag is present
getDashboard();

export const app = express();

// Security: Optional Bearer Token for the proxy itself
const HUSH_TOKEN = process.env.HUSH_AUTH_TOKEN;

app.use(cors({ origin: 'http://localhost' })); // Restrict CORS
app.use(express.json({ limit: '50mb' }));

/**
 * Security Middleware: Local Proxy Authentication
 */
app.use((req, res, next) => {
  const path: string = req.path || '/';
  if (path === '/health') return next();
  
  if (HUSH_TOKEN) {
    const authHeader = req.headers['x-hush-token'] || req.headers['authorization'];
    const providedToken = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    
    if (!providedToken || (providedToken !== HUSH_TOKEN && providedToken !== `Bearer ${HUSH_TOKEN}`)) {
      log.warn({ ip: req.ip }, 'Unauthorized access attempt');
      return res.status(401).json({ error: 'Unauthorized: Invalid HUSH_AUTH_TOKEN' });
    }
  }
  next();
});

/**
 * Helper to handle proxying with optional streaming
 */
async function proxyRequest(
  req: express.Request,
  res: express.Response,
  targetUrl: string,
  headers: Record<string, string>
) {
  const startTime = performance.now();
  const dashboard = getDashboard();
  const path: string = req.path || req.url || '/';
  
  // 1. Redact Request Body (Prompts, Tool Results)
  const { content: redactedBody, tokens, hasRedacted } = redactor.redact(req.body);
  const redactionDuration = Math.round(performance.now() - startTime);

  // Log all requests to dashboard
  if (dashboard) {
    dashboard.logRequest(path, redactionDuration);
  }

  if (hasRedacted) {
    log.info({ path: String(path), tokenCount: tokens.size, duration: redactionDuration }, 'Redacted sensitive data from request');
    vault.saveTokens(tokens);
    
    // Log redaction events
    if (dashboard) {
      tokens.forEach((value, token) => {
        const type = token.split('_')[1] || 'UNKNOWN';
        dashboard.logRedaction(type, token);
      });
    }
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
      log.error({ status: response.status, path: String(path) }, 'Upstream provider returned an error');
      const errorData = await response.text();
      return res.status(response.status).send(errorData);
    }

    // Case A: Streaming
    if (req.body.stream && response.body) {
      log.info({ path: String(path) }, 'Starting stream proxy');
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      // Security: Use stateful rehydrator to handle tokens split across chunks
      const rehydrateChunk = vault.createStreamingRehydrator();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const rehydratedChunk = rehydrateChunk(chunk);
          
          if (rehydratedChunk) {
            const canWrite = res.write(rehydratedChunk);
            // Handle backpressure
            if (!canWrite) {
              await new Promise((resolve) => res.once('drain', resolve));
            }
          }
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
    log.error({ err: error, path: String(path) }, 'Failed to forward request');
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

/**
 * Handle Google Gemini API proxy
 * Supports: /v1beta/models/{model}:generateContent
 */
app.post('/v1beta/models/:modelAndAction', async (req, res) => {
  const apiKey = req.headers['x-goog-api-key'] || req.query.key;
  if (!apiKey) return res.status(401).json({ error: 'Missing Google API Key' });

  const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${req.params.modelAndAction}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;

  await proxyRequest(req, res, targetUrl, {
    'x-goog-api-key': apiKey as string,
  });
});

/**
 * Catch-all Handler: Forward any other requests to Google
 * This ensures login and metadata calls work correctly.
 */
app.all('*', async (req, res) => {
  const targetBase = 'https://generativelanguage.googleapis.com';
  const targetUrl = `${targetBase}${req.url}`;
  const path: string = req.path || '/';
  const method: string = req.method || 'GET';
  
  log.info({ path: String(path), method: String(method) }, 'Forwarding unknown endpoint to Google');

  try {
    const headers: any = { ...req.headers };
    delete headers.host;
    delete headers.connection;

    const response = await fetch(targetUrl, {
      method,
      headers,
      body: ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(30000),
    });

    const data = await response.text();
    res.status(response.status).send(data);
  } catch (error) {
    log.error({ err: error, path: String(path) }, 'Catch-all forwarding failed');
    res.status(500).json({ error: 'Gateway forwarding failed' });
  }
});

// Health check
app.get('/health', (req, res) => {
  const response: any = { status: 'running' };
  if (process.env.DEBUG === 'true') {
    response.vaultSize = vault.size;
  }
  res.json(response);
});
