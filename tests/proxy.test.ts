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
  });

  describe('Health Check', () => {
    it('should return running status', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('running');
    });
  });
});
