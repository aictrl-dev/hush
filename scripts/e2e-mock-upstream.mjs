/**
 * Mock ZhipuAI upstream server for E2E testing.
 * Captures the request body sent by the Hush gateway so we can verify PII was redacted.
 */
import http from 'node:http';
import fs from 'node:fs';

const PORT = parseInt(process.env.MOCK_PORT || '4111');
const CAPTURE_FILE = process.env.CAPTURE_FILE || '/tmp/hush-e2e-captured-body.json';

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/paas/v4/chat/completions') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      // Save the captured request body for later verification
      fs.writeFileSync(CAPTURE_FILE, body);

      const parsed = JSON.parse(body);
      // Echo back the last user message content so we can verify rehydration
      const lastMessage = parsed.messages?.[parsed.messages.length - 1]?.content || '';

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-e2e-mock-001',
        model: 'glm-5',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: `Echoing back: ${lastMessage}` },
          finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 }
      }));
    });
  } else if (req.method === 'GET' && req.url === '/captured') {
    try {
      const captured = fs.readFileSync(CAPTURE_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(captured);
    } catch {
      res.writeHead(404);
      res.end('{}');
    }
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'mock-running' }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock ZhipuAI upstream listening on http://127.0.0.1:${PORT}`);
});
