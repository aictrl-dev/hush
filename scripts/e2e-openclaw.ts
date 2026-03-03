/**
 * Simulated E2E test for OpenClaw integration.
 * 
 * This test simulates the two layers of protection:
 * 1. The Skill (Local): Intercepts tool calls and redacts their outputs.
 * 2. The Proxy (Cloud): Intercepts API requests from OpenClaw and redacts PII.
 */

import http from 'node:http';
import fs from 'node:fs';
import { HushSkill } from '../src/plugins/openclaw-hush.js';
import { Redactor } from '../src/middleware/redactor.js';
import { TokenVault } from '../src/vault/token-vault.js';

// Configuration
const MOCK_PORT = 4991;
const GATEWAY_PORT = 4992;
const CAPTURE_FILE = '/tmp/hush-openclaw-captured.json';

// --- Step 1: Mock Upstream (ZhipuAI/OpenAI) ---
const mockUpstream = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      fs.writeFileSync(CAPTURE_FILE, body);
      const parsed = JSON.parse(body);
      const lastMessage = parsed.messages?.[parsed.messages.length - 1]?.content || '';
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-e2e-mock-001',
        choices: [{
          message: { role: 'assistant', content: `Echo: ${lastMessage}` }
        }]
      }));
    });
  } else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  }
});

// --- Step 2: Hush Gateway (Proxy) ---
const redactor = new Redactor();
const vault = new TokenVault();

const gateway = http.createServer(async (req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      const bodyParsed = JSON.parse(body);
      const { content: redactedBody, tokens, hasRedacted } = redactor.redact(bodyParsed);
      if (hasRedacted) {
        vault.saveTokens(tokens);
      }

      const upstreamRes = await fetch(`http://127.0.0.1:${MOCK_PORT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(redactedBody)
      });
      const data = await upstreamRes.json();
      const rehydrated = vault.rehydrate(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rehydrated));
    });
  } else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', vaultSize: vault.size }));
  }
});

// --- Main Test Routine ---
async function runTest() {
  console.log('--- OpenClaw Simulated E2E Test ---');

  mockUpstream.listen(MOCK_PORT, '127.0.0.1');
  gateway.listen(GATEWAY_PORT, '127.0.0.1');

  try {
    const skill = await HushSkill();

    // 1. Test SKILL Blocking (Pre-execution)
    console.log('[1/4] Testing Skill Blocking...');
    const blockResult = await skill['before_tool_call']({ 
      toolName: 'read', 
      params: { filePath: '.env' } 
    });
    if (blockResult?.block === true) {
      console.log('  PASS: Blocked sensitive file read');
    } else {
      throw new Error('Should have blocked .env read');
    }

    // 2. Test SKILL Redaction (Post-execution)
    console.log('[2/4] Testing Skill Output Redaction...');
    const event = { 
      toolName: 'bash', 
      params: {}, 
      result: { stdout: 'My secret email is bulat@aictrl.dev' } 
    };
    await skill['after_tool_call'](event);
    if (event.result.stdout.includes('bulat@aictrl.dev')) {
      throw new Error('Skill failed to redact output');
    }
    console.log('  PASS: Redacted tool output before AI sees it');
    console.log(`  Output: ${event.result.stdout}`);

    // 3. Test PROXY Redaction (Outgoing API)
    console.log('[3/4] Testing Proxy API Redaction...');
    const apiRequest = {
      model: 'glm-5',
      messages: [{ role: 'user', content: `Contact another-email@example.com for help.` }]
    };

    const res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(apiRequest)
    });
    
    const apiResponse = await res.json();
    const captured = JSON.parse(fs.readFileSync(CAPTURE_FILE, 'utf8'));
    const messageToUpstream = captured.messages[0].content;
    
    if (messageToUpstream.includes('another-email@example.com')) {
      throw new Error('Proxy failed to redact outgoing PII');
    }
    console.log('  PASS: Redacted PII in cloud request');

    // 4. Test PROXY Rehydration (Incoming Response)
    console.log('[4/4] Testing Proxy Response Rehydration...');
    const assistantContent = apiResponse.choices[0].message.content;
    
    if (!assistantContent.includes('another-email@example.com')) {
      throw new Error(`Proxy failed to rehydrate response.`);
    }
    console.log('  PASS: Rehydrated PII in response to OpenClaw');
    console.log(`  Assistant: ${assistantContent}`);

    console.log('\n--- ALL E2E CHECKS PASSED ---');
  } catch (err) {
    console.error('\n--- E2E TEST FAILED ---');
    console.error(err);
    process.exit(1);
  } finally {
    mockUpstream.close();
    gateway.close();
    if (fs.existsSync(CAPTURE_FILE)) fs.unlinkSync(CAPTURE_FILE);
  }
}

runTest();
