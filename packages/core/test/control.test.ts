import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ControlApi } from '../src/control/api.js';
import { SessionManager } from '../src/session/manager.js';
import {
  CONTROL_API_CSRF_HEADER,
  CONTROL_API_CLI_HEADER,
  DEVMIRROR_DEV_EXTENSION_ID
} from '@devmirror/shared';

describe('ControlApi', () => {
  let sessionManager: SessionManager;
  let controlApi: ControlApi;

  beforeEach(() => {
    sessionManager = new SessionManager();
    controlApi = new ControlApi({
      port: 4100,
      sessionManager,
      lanIp: '192.168.1.50',
      proxyPort: 4000,
      controlToken: 'test-control-secret-token',
      onDiscover: async () => [
        { host: '127.0.0.1', port: 5173, framework: 'vite', frameworkName: 'Vite', status: 'online', isHttps: false, confidence: 'high' }
      ]
    });
  });

  afterEach(async () => {
    if (controlApi.running) {
      await controlApi.stop();
    }
  });

  it('should return 200 on /health without exposing secrets', async () => {
    const response = await controlApi.fastify.inject({
      method: 'GET',
      url: '/health',
      headers: { host: '127.0.0.1:4100' }
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.1.0');
    expect(body.uptimeSeconds).toBeTypeOf('number');
    expect(body.token).toBeUndefined();
  });

  it('should reject requests with invalid Host header (403 Forbidden)', async () => {
    const response = await controlApi.fastify.inject({
      method: 'GET',
      url: '/health',
      headers: { host: 'attacker.lan:4100' }
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.error).toContain('Invalid Host header');
  });

  it('should reject cross-origin requests from arbitrary external origins (403 Forbidden)', async () => {
    const response = await controlApi.fastify.inject({
      method: 'GET',
      url: '/health',
      headers: {
        host: 'localhost:4100',
        origin: 'http://malicious-site.com'
      }
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.error).toContain('Cross-origin request denied');
  });

  describe('Extension Origin Allowlist & Malformed Origin Rejection', () => {
    it('should permit requests from exact allowed development extension ID', async () => {
      const extRes = await controlApi.fastify.inject({
        method: 'GET',
        url: '/health',
        headers: {
          host: '127.0.0.1:4100',
          origin: `chrome-extension://${DEVMIRROR_DEV_EXTENSION_ID}`
        }
      });
      expect(extRes.statusCode).toBe(200);
      expect(extRes.headers['access-control-allow-origin']).toBe(
        `chrome-extension://${DEVMIRROR_DEV_EXTENSION_ID}`
      );
    });

    it('should reject arbitrary or mismatched extension IDs (403 Forbidden)', async () => {
      const extRes = await controlApi.fastify.inject({
        method: 'GET',
        url: '/health',
        headers: {
          host: '127.0.0.1:4100',
          // 32 chars in [a-p] but not in allowlist
          origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        }
      });
      expect(extRes.statusCode).toBe(403);
      expect(JSON.parse(extRes.body).error).toContain('Cross-origin request denied');
    });

    it('should reject malformed extension origins (paths, credentials, invalid chars)', async () => {
      // Non-32 char length
      const res1 = await controlApi.fastify.inject({
        method: 'GET',
        url: '/health',
        headers: { host: '127.0.0.1:4100', origin: 'chrome-extension://shortid' }
      });
      expect(res1.statusCode).toBe(403);

      // Path in origin
      const res2 = await controlApi.fastify.inject({
        method: 'GET',
        url: '/health',
        headers: { host: '127.0.0.1:4100', origin: `chrome-extension://${DEVMIRROR_DEV_EXTENSION_ID}/path` }
      });
      expect(res2.statusCode).toBe(403);

      // Credentials in origin
      const res3 = await controlApi.fastify.inject({
        method: 'GET',
        url: '/health',
        headers: { host: '127.0.0.1:4100', origin: `chrome-extension://user:pass@${DEVMIRROR_DEV_EXTENSION_ID}` }
      });
      expect(res3.statusCode).toBe(403);
    });
  });

  describe('CORS Preflight (OPTIONS /*)', () => {
    it('should return 204 with exact Access-Control-Allow-Origin for trusted extension', async () => {
      const response = await controlApi.fastify.inject({
        method: 'OPTIONS',
        url: '/api/v1/session',
        headers: {
          host: '127.0.0.1:4100',
          origin: `chrome-extension://${DEVMIRROR_DEV_EXTENSION_ID}`,
          'access-control-request-method': 'POST',
          'access-control-request-headers': `content-type, ${CONTROL_API_CSRF_HEADER}`
        }
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(
        `chrome-extension://${DEVMIRROR_DEV_EXTENSION_ID}`
      );
      expect(response.headers['access-control-allow-methods']).toContain('POST');
    });

    it('should reject preflight from unauthorized origin (403 Forbidden)', async () => {
      const response = await controlApi.fastify.inject({
        method: 'OPTIONS',
        url: '/api/v1/session',
        headers: {
          host: '127.0.0.1:4100',
          origin: 'http://evil.com',
          'access-control-request-method': 'POST'
        }
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject preflight requesting disallowed methods (403 Forbidden)', async () => {
      const response = await controlApi.fastify.inject({
        method: 'OPTIONS',
        url: '/api/v1/session',
        headers: {
          host: '127.0.0.1:4100',
          origin: `chrome-extension://${DEVMIRROR_DEV_EXTENSION_ID}`,
          'access-control-request-method': 'PUT' // only GET, POST, DELETE, OPTIONS
        }
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('Pairing URL Security (/api/v1/session/pairing-url)', () => {
    beforeEach(async () => {
      // Create an active session
      await controlApi.fastify.inject({
        method: 'POST',
        url: '/api/v1/session',
        headers: {
          host: '127.0.0.1:4100',
          [CONTROL_API_CSRF_HEADER]: '1'
        },
        payload: {
          target: { port: 5173, host: '127.0.0.1', framework: 'vite' }
        }
      });
    });

    it('should allow trusted extension to retrieve unmasked pairingUrl without separate token field', async () => {
      const response = await controlApi.fastify.inject({
        method: 'GET',
        url: '/api/v1/session/pairing-url',
        headers: {
          host: '127.0.0.1:4100',
          origin: `chrome-extension://${DEVMIRROR_DEV_EXTENSION_ID}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.pairingUrl).toContain('http://192.168.1.50:4000/?dm_token=');
      // Token must NOT be exposed as a separate top-level property
      expect(body.token).toBeUndefined();
    });

    it('should REJECT localhost websites from accessing pairing-url (403 Forbidden)', async () => {
      const response = await controlApi.fastify.inject({
        method: 'GET',
        url: '/api/v1/session/pairing-url',
        headers: {
          host: '127.0.0.1:4100',
          origin: 'http://localhost:3000' // web page on port 3000
        }
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).error).toContain('Localhost websites are not authorized');
    });

    it('should allow local CLI with x-devmirror-cli header when Origin is absent', async () => {
      const response = await controlApi.fastify.inject({
        method: 'GET',
        url: '/api/v1/session/pairing-url',
        headers: {
          host: '127.0.0.1:4100',
          [CONTROL_API_CLI_HEADER]: '1'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.pairingUrl).toContain('http://192.168.1.50:4000/?dm_token=');
    });

    it('should reject CLI access when no intent headers are present (403 Forbidden)', async () => {
      const response = await controlApi.fastify.inject({
        method: 'GET',
        url: '/api/v1/session/pairing-url',
        headers: {
          host: '127.0.0.1:4100'
        }
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 404 when session is revoked or inactive', async () => {
      // Revoke session
      await controlApi.fastify.inject({
        method: 'DELETE',
        url: '/api/v1/session',
        headers: {
          host: '127.0.0.1:4100',
          [CONTROL_API_CSRF_HEADER]: '1'
        }
      });

      const response = await controlApi.fastify.inject({
        method: 'GET',
        url: '/api/v1/session/pairing-url',
        headers: {
          host: '127.0.0.1:4100',
          origin: `chrome-extension://${DEVMIRROR_DEV_EXTENSION_ID}`
        }
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error).toContain('No active session');
    });
  });

  describe('Discovery Endpoint (/api/v1/discover)', () => {
    it('should return discovered dev servers without starting a session', async () => {
      const response = await controlApi.fastify.inject({
        method: 'GET',
        url: '/api/v1/discover',
        headers: { host: '127.0.0.1:4100' }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.servers.length).toBe(1);
      expect(body.servers[0].framework).toBe('vite');
      expect(body.servers[0].port).toBe(5173);

      // Verify no session was created
      const sessionRes = await controlApi.fastify.inject({
        method: 'GET',
        url: '/api/v1/session',
        headers: { host: '127.0.0.1:4100' }
      });
      expect(sessionRes.statusCode).toBe(404);
    });
  });

  describe('Session Management & CSRF', () => {
    it('should enforce CSRF protection on mutating methods without custom headers', async () => {
      const response = await controlApi.fastify.inject({
        method: 'POST',
        url: '/api/v1/session',
        headers: { host: '127.0.0.1:4100' },
        payload: {
          target: { port: 5173 }
        }
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).error).toContain('Mutating operations require');
    });

    it('should reject invalid target ports (< 1024 or > 65535)', async () => {
      const response = await controlApi.fastify.inject({
        method: 'POST',
        url: '/api/v1/session',
        headers: {
          host: '127.0.0.1:4100',
          [CONTROL_API_CSRF_HEADER]: '1'
        },
        payload: {
          target: { port: 80 }
        }
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toContain('between 1024 and 65535');
    });

    it('should reject non-loopback target host to prevent SSRF', async () => {
      const response = await controlApi.fastify.inject({
        method: 'POST',
        url: '/api/v1/session',
        headers: {
          host: '127.0.0.1:4100',
          [CONTROL_API_CSRF_HEADER]: '1'
        },
        payload: {
          target: { port: 8080, host: '169.254.169.254' }
        }
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toContain('must be 127.0.0.1 or localhost');
    });
  });
});
