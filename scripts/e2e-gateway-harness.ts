/**
 * E2E test harness: Hush gateway that proxies to mock upstream.
 * Replicates the real gateway's redact -> forward -> rehydrate flow
 * but points at a local mock instead of api.z.ai.
 */
import express from 'express';
import { Redactor } from '../src/middleware/redactor.js';
import { TokenVault } from '../src/vault/token-vault.js';

const redactor = new Redactor();
const vault = new TokenVault();

const app = express();
app.use(express.json({ limit: '50mb' }));

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '4000');
const MOCK_PORT = parseInt(process.env.MOCK_PORT || '4111');
const MOCK_UPSTREAM = `http://127.0.0.1:${MOCK_PORT}/api/paas/v4/chat/completions`;

// ZhipuAI GLM route (same as real gateway, but targeting mock upstream)
app.post('/api/paas/v4/chat/completions', async (req, res) => {
  const auth = req.headers['authorization'];
  if (!auth) return res.status(401).json({ error: 'Missing Authorization' });

  // 1. Redact
  const { content: redactedBody, tokens, hasRedacted } = redactor.redact(req.body);
  if (hasRedacted) {
    vault.saveTokens(tokens);
    console.log(`[E2E] Redacted ${tokens.size} PII token(s)`);
    for (const [token] of tokens) {
      console.log(`[E2E]   ${token}`);
    }
  }

  try {
    // 2. Forward to mock upstream
    const response = await fetch(MOCK_UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': auth as string },
      body: JSON.stringify(redactedBody),
    });

    const data = await response.json();

    // 3. Rehydrate
    const rehydrated = vault.rehydrate(data);
    res.json(rehydrated);
  } catch (error) {
    console.error('[E2E] Forward failed:', error);
    res.status(500).json({ error: 'E2E gateway forward failed' });
  }
});

// Health endpoint exposes vault size
app.get('/health', (_req, res) => {
  res.json({ status: 'running', vaultSize: vault.size });
});

app.listen(GATEWAY_PORT, '127.0.0.1', () => {
  console.log(`E2E Hush Gateway listening on http://127.0.0.1:${GATEWAY_PORT}`);
  console.log(`  Upstream: ${MOCK_UPSTREAM}`);
});
