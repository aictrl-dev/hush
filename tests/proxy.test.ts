import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import nock from 'nock';
import { app } from '../src/index';

describe('Hush Proxy E2E Tests', () => {
  
  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.restore();
    nock.activate();
  });

  describe('Anthropic Proxy (/v1/messages)', () => {
    it('should redact outbound messages and rehydrate inbound results', async () => {
      // Mock Anthropic API
      const scope = nock('https://api.anthropic.com')
        .post('/v1/messages', (body) => {
          // Verify redaction happened before forwarding
          return JSON.stringify(body).includes('[USER_EMAIL_1]');
        })
        .reply(200, {
          id: 'msg_123',
          content: [{ type: 'text', text: 'Hello [USER_EMAIL_1]' }]
        });

      const response = await request(app)
        .post('/v1/messages')
        .set('x-api-key', 'test-key')
        .send({
          model: 'claude-3-5-sonnet-latest',
          messages: [{ role: 'user', content: 'My email is bulat@aictrl.dev' }]
        });

      expect(response.status).toBe(200);
      // Verify rehydration happened on the way back
      expect(response.body.content[0].text).toBe('Hello bulat@aictrl.dev');
      expect(scope.isDone()).toBe(true);
    });

    it('should handle streaming responses with rehydration', async () => {
        // 1. Mock the first seeding request
        nock('https://api.anthropic.com')
          .post('/v1/messages')
          .reply(200, {
            id: 'msg_seed',
            content: [{ type: 'text', text: 'OK' }]
          });

        // 2. Mock the second streaming response
        const streamData = [
          'data: {"type": "message_start", "message": {"id": "msg_123"}}\n\n',
          'data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hello [USER_EMAIL_1]"}}\n\n',
          'data: {"type": "message_stop"}\n\n'
        ];

        nock('https://api.anthropic.com')
          .post('/v1/messages')
          .reply(200, streamData.join(''), {
            'Content-Type': 'text/event-stream'
          });

        // Seed the vault first
        await request(app)
          .post('/v1/messages')
          .set('x-api-key', 'test-key')
          .send({
            messages: [{ role: 'user', content: 'bulat@aictrl.dev' }]
          });

        // Execute streaming request
        const response = await request(app)
          .post('/v1/messages')
          .set('x-api-key', 'test-key')
          .send({
            stream: true,
            messages: [{ role: 'user', content: 'hi' }]
          });

        expect(response.status).toBe(200);
        expect(response.text).toContain('Hello bulat@aictrl.dev');
    });
  });

  describe('OpenAI Proxy (/v1/chat/completions)', () => {
    it('should redact and proxy OpenAI requests', async () => {
      const scope = nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          choices: [{ message: { content: 'Rehydrated: [USER_EMAIL_1]' } }]
        });

      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer test-token')
        .send({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Email is bulat@aictrl.dev' }]
        });

      expect(response.status).toBe(200);
      expect(response.body.choices[0].message.content).toBe('Rehydrated: bulat@aictrl.dev');
      expect(scope.isDone()).toBe(true);
    });

    it('should forward upstream error status and body', async () => {
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(429, { error: { message: 'Rate limit exceeded' } });

      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer test-token')
        .send({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });

      expect(response.status).toBe(429);
      expect(JSON.parse(response.text).error.message).toBe('Rate limit exceeded');
    });
  });

  describe('ZhipuAI GLM Proxy (/api/paas/v4/chat/completions)', () => {
    it('should redact PII and proxy GLM-5 requests', async () => {
      const scope = nock('https://api.z.ai')
        .post('/api/paas/v4/chat/completions', (body) => {
          return JSON.stringify(body).includes('[USER_EMAIL_1]');
        })
        .reply(200, {
          id: 'chatcmpl-glm5-abc123',
          model: 'glm-5',
          choices: [{ message: { role: 'assistant', content: 'Got it, your email is [USER_EMAIL_1]' } }],
          usage: { prompt_tokens: 15, completion_tokens: 12, total_tokens: 27 }
        });

      const response = await request(app)
        .post('/api/paas/v4/chat/completions')
        .set('Authorization', 'Bearer zhipu-test-key')
        .send({
          model: 'glm-5',
          messages: [{ role: 'user', content: 'My email is bulat@aictrl.dev' }]
        });

      expect(response.status).toBe(200);
      expect(response.body.choices[0].message.content).toBe('Got it, your email is bulat@aictrl.dev');
      expect(scope.isDone()).toBe(true);
    });

    it('should redact multiple PII types in GLM requests', async () => {
      const scope = nock('https://api.z.ai')
        .post('/api/paas/v4/chat/completions', (body) => {
          const bodyStr = JSON.stringify(body);
          // Verify ALL PII types were redacted before reaching upstream
          return bodyStr.includes('[USER_EMAIL_') &&
                 bodyStr.includes('[NETWORK_IP_') &&
                 !bodyStr.includes('bulat@aictrl.dev') &&
                 !bodyStr.includes('192.168.1.100');
        })
        .reply(200, {
          id: 'chatcmpl-glm5-multi',
          model: 'glm-5',
          choices: [{ message: { role: 'assistant', content: 'I will not store any of that information.' } }],
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 }
        });

      const response = await request(app)
        .post('/api/paas/v4/chat/completions')
        .set('Authorization', 'Bearer zhipu-test-key')
        .send({
          model: 'glm-5',
          messages: [{ role: 'user', content: 'Server bulat@aictrl.dev is at 192.168.1.100' }]
        });

      expect(response.status).toBe(200);
      expect(scope.isDone()).toBe(true);
    });

    it('should handle GLM streaming responses with rehydration', async () => {
      // 1. Seed the vault via a non-streaming request
      nock('https://api.z.ai')
        .post('/api/paas/v4/chat/completions')
        .reply(200, {
          id: 'chatcmpl-glm5-seed',
          model: 'glm-5',
          choices: [{ message: { content: 'OK' } }]
        });

      // 2. Mock streaming response that echoes back the token
      const streamData = [
        'data: {"id":"chatcmpl-glm5-stream","model":"glm-5","choices":[{"delta":{"content":"Hello [USER_EMAIL_1]"}}]}\n\n',
        'data: [DONE]\n\n'
      ];

      nock('https://api.z.ai')
        .post('/api/paas/v4/chat/completions')
        .reply(200, streamData.join(''), {
          'Content-Type': 'text/event-stream'
        });

      // Seed the vault
      await request(app)
        .post('/api/paas/v4/chat/completions')
        .set('Authorization', 'Bearer zhipu-test-key')
        .send({
          model: 'glm-5',
          messages: [{ role: 'user', content: 'bulat@aictrl.dev' }]
        });

      // Execute streaming request
      const response = await request(app)
        .post('/api/paas/v4/chat/completions')
        .set('Authorization', 'Bearer zhipu-test-key')
        .send({
          stream: true,
          model: 'glm-5',
          messages: [{ role: 'user', content: 'hi' }]
        });

      expect(response.status).toBe(200);
      expect(response.text).toContain('Hello bulat@aictrl.dev');
    });

    it('should forward GLM upstream errors', async () => {
      nock('https://api.z.ai')
        .post('/api/paas/v4/chat/completions')
        .reply(429, { error: { message: 'Rate limit exceeded', code: '1261' } });

      const response = await request(app)
        .post('/api/paas/v4/chat/completions')
        .set('Authorization', 'Bearer zhipu-test-key')
        .send({ model: 'glm-5', messages: [{ role: 'user', content: 'hi' }] });

      expect(response.status).toBe(429);
      expect(JSON.parse(response.text).error.message).toBe('Rate limit exceeded');
    });

    it('should reject requests without Authorization header', async () => {
      const response = await request(app)
        .post('/api/paas/v4/chat/completions')
        .send({ model: 'glm-5', messages: [{ role: 'user', content: 'hi' }] });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Missing ZhipuAI Authorization');
    });
  });

  describe('Health Check', () => {
    it('should return running status', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('running');
    });
  });
});
