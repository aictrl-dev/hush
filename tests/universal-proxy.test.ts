import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import nock from 'nock';
import { app } from '../src/index';

describe('Universal Proxy Mode', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.restore();
    nock.activate();
  });

  describe('Method-agnostic proxyRequest', () => {
    it('should forward GET requests without a body', async () => {
      const scope = nock('https://api.anthropic.com')
        .get('/v1/models')
        .reply(200, { models: ['claude-3'] });

      // GET /v1/models is not a known route, so it hits the catch-all.
      // We need HUSH_UPSTREAM set to Anthropic for this test, but since
      // env is already set at module load, we test via the catch-all going to Google.
      // Instead, test via a known route that we can mock as GET — but existing
      // routes are POST only. So let's test via catch-all to Google.
      const scope2 = nock('https://generativelanguage.googleapis.com')
        .get('/v1/some-endpoint')
        .reply(200, { result: 'ok' });

      const response = await request(app)
        .get('/v1/some-endpoint');

      expect(response.status).toBe(200);
      expect(response.body.result).toBe('ok');
      expect(scope2.isDone()).toBe(true);
    });

    it('should forward DELETE requests without a body', async () => {
      const scope = nock('https://generativelanguage.googleapis.com')
        .delete('/v1/some-resource/123')
        .reply(200, { deleted: true });

      const response = await request(app)
        .delete('/v1/some-resource/123');

      expect(response.status).toBe(200);
      expect(response.body.deleted).toBe(true);
      expect(scope.isDone()).toBe(true);
    });

    it('should forward PUT requests with body and redaction', async () => {
      const scope = nock('https://generativelanguage.googleapis.com')
        .put('/v1/some-resource/123', (body) => {
          // Verify email was redacted
          return JSON.stringify(body).includes('[USER_EMAIL_');
        })
        .reply(200, { updated: true });

      const response = await request(app)
        .put('/v1/some-resource/123')
        .send({ data: 'Contact me at bulat@aictrl.dev' });

      expect(response.status).toBe(200);
      expect(response.body.updated).toBe(true);
      expect(scope.isDone()).toBe(true);
    });
  });

  describe('Auth header passthrough', () => {
    it('should forward Authorization header through catch-all', async () => {
      const scope = nock('https://generativelanguage.googleapis.com', {
        reqheaders: {
          'Authorization': 'Bearer my-secret-token',
        },
      })
        .get('/v1/some-protected')
        .reply(200, { access: 'granted' });

      const response = await request(app)
        .get('/v1/some-protected')
        .set('Authorization', 'Bearer my-secret-token');

      expect(response.status).toBe(200);
      expect(response.body.access).toBe('granted');
      expect(scope.isDone()).toBe(true);
    });

    it('should forward x-api-key header through catch-all', async () => {
      const scope = nock('https://generativelanguage.googleapis.com', {
        reqheaders: {
          'x-api-key': 'sk-ant-test-key',
        },
      })
        .get('/v1/some-api')
        .reply(200, { ok: true });

      const response = await request(app)
        .get('/v1/some-api')
        .set('x-api-key', 'sk-ant-test-key');

      expect(response.status).toBe(200);
      expect(scope.isDone()).toBe(true);
    });
  });

  describe('Catch-all with redaction', () => {
    it('should redact PII in catch-all POST requests', async () => {
      const scope = nock('https://generativelanguage.googleapis.com')
        .post('/v1/unknown-endpoint', (body) => {
          const bodyStr = JSON.stringify(body);
          return bodyStr.includes('[USER_EMAIL_') && !bodyStr.includes('bulat@aictrl.dev');
        })
        .reply(200, { processed: true });

      const response = await request(app)
        .post('/v1/unknown-endpoint')
        .send({ message: 'Email me at bulat@aictrl.dev' });

      expect(response.status).toBe(200);
      expect(response.body.processed).toBe(true);
      expect(scope.isDone()).toBe(true);
    });

    it('should rehydrate tokens in catch-all responses', async () => {
      // First, seed the vault via a known route
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, {
          id: 'msg_seed',
          content: [{ type: 'text', text: 'OK' }],
        });

      await request(app)
        .post('/v1/messages')
        .set('x-api-key', 'test-key')
        .send({ messages: [{ role: 'user', content: 'bulat@aictrl.dev' }] });

      // Now test catch-all rehydration
      nock('https://generativelanguage.googleapis.com')
        .post('/v1/custom-endpoint')
        .reply(200, { response: 'Your email is [USER_EMAIL_1]' });

      const response = await request(app)
        .post('/v1/custom-endpoint')
        .send({ query: 'what is my email?' });

      expect(response.status).toBe(200);
      expect(response.body.response).toBe('Your email is bulat@aictrl.dev');
    });
  });

  describe('Health check unaffected', () => {
    it('should still return health status', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('running');
    });
  });
});
