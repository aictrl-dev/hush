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

// Security: Bind only to localhost by default to prevent network exposure
const BIND_ADDRESS = process.env.HUSH_HOST || '127.0.0.1';

// Security: Optional Bearer Token for the proxy itself
const HUSH_TOKEN = process.env.HUSH_AUTH_TOKEN;

app.use(cors({ origin: 'http://localhost' })); // Restrict CORS
app.use(express.json({ limit: '50mb' }));

/**
 * Security Middleware: Local Proxy Authentication
 */
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  
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
  
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(req.method);

  // 1. Redact Request Body (Prompts, Tool Results) — only for methods with a body
  let redactedBody: any;
  let tokens = new Map<string, string>();
  let hasRedacted = false;

  if (hasBody) {
    const result = redactor.redact(req.body);
    redactedBody = result.content;
    tokens = result.tokens;
    hasRedacted = result.hasRedacted;
  }

  const redactionDuration = Math.round(performance.now() - startTime);

  // Log all requests to dashboard
  if (dashboard) {
    dashboard.logRequest(req.path, redactionDuration);
  }

  if (hasRedacted) {
    log.info({ path: req.path, tokenCount: tokens.size, duration: redactionDuration }, 'Redacted sensitive data from request');
    vault.saveTokens(tokens);

    // Log redaction events
    if (dashboard) {
      tokens.forEach((value, token) => {
        const type = token.split('_')[1] ?? 'UNK'; // Extract type from [HUSH_TYPE_ID]
        dashboard!.logRedaction(type, token);
      });
    }
  }

  try {
    const fetchHeaders: Record<string, string> = { ...headers };
    if (hasBody) fetchHeaders['Content-Type'] = 'application/json';

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: fetchHeaders,
      body: hasBody ? JSON.stringify(redactedBody) : undefined,
      signal: AbortSignal.timeout(120000), // 120s timeout for long LLM responses
    });

    // Handle Upstream Errors (4xx, 5xx)
    if (!response.ok) {
      log.error({ status: response.status, path: req.path }, 'Upstream provider returned an error');
      const errorData = await response.text();
      return res.status(response.status).send(errorData);
    }

    // Case A: Streaming
    const isStreaming = req.body?.stream === true || req.body?.stream === 'true';
    if (isStreaming && response.body) {
      log.info({ path: req.path }, 'Starting stream proxy');
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
    log.error({ err: error, path: req.path }, 'Failed to forward request');
    if (!res.headersSent) {
      res.status(502).json({ error: 'Gateway forwarding failed' });
    } else {
      // Headers already sent (streaming in progress) — just end the response
      res.end();
    }
  }
}

/**
 * Handle Anthropic /messages proxy
 */
app.post('/v1/messages', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  const auth = req.headers['authorization'];
  if (!apiKey && !auth) return res.status(401).json({ error: 'Missing Anthropic API Key or Authorization header' });

  const headers: Record<string, string> = {
    'anthropic-version': req.headers['anthropic-version'] as string || '2023-06-01',
  };
  if (req.headers['anthropic-beta']) headers['anthropic-beta'] = req.headers['anthropic-beta'] as string;
  if (apiKey) headers['x-api-key'] = apiKey as string;
  if (auth) headers['Authorization'] = auth as string;

  await proxyRequest(req, res, 'https://api.anthropic.com/v1/messages', headers);
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
 * Handle ZhipuAI GLM API proxy (OpenCode + GLM-5)
 * Supports both regular and coding plan endpoints:
 *   /api/paas/v4/chat/completions        → https://api.z.ai/api/paas/v4/chat/completions
 *   /api/coding/paas/v4/chat/completions  → https://api.z.ai/api/coding/paas/v4/chat/completions
 */
app.post('/api/paas/v4/chat/completions', async (req, res) => {
  const auth = req.headers['authorization'];
  if (!auth) return res.status(401).json({ error: 'Missing ZhipuAI Authorization' });

  await proxyRequest(req, res, 'https://api.z.ai/api/paas/v4/chat/completions', {
    'Authorization': auth as string,
  });
});

app.post('/api/coding/paas/v4/chat/completions', async (req, res) => {
  const auth = req.headers['authorization'];
  if (!auth) return res.status(401).json({ error: 'Missing ZhipuAI Authorization' });

  await proxyRequest(req, res, 'https://api.z.ai/api/coding/paas/v4/chat/completions', {
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

// Health check (must be before catch-all)
app.get('/health', (req, res) => {
  const response: any = { status: 'running' };
  if (process.env.DEBUG === 'true') {
    response.vaultSize = vault.size;
  }
  res.json(response);
});

/**
 * Catch-all Handler: Forward unmatched requests with redaction/rehydration.
 * Uses HUSH_UPSTREAM if set, otherwise falls back to Google.
 */
app.all('/*path', async (req, res) => {
  const targetBase = 'https://generativelanguage.googleapis.com';
  const targetUrl = `${targetBase}${req.url}`;

  log.info({ path: req.path, method: req.method, upstream: targetBase }, 'Forwarding to upstream');

  // Collect auth headers to pass through
  const headers: Record<string, string> = {};
  if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'] as string;
  if (req.headers['x-api-key']) headers['x-api-key'] = req.headers['x-api-key'] as string;
  if (req.headers['x-goog-api-key']) headers['x-goog-api-key'] = req.headers['x-goog-api-key'] as string;

  await proxyRequest(req, res, targetUrl, headers);
});
