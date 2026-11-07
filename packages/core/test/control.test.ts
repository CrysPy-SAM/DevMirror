import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ControlApi } from '../src/control/api.js';
import { SessionManager } from '../src/session/manager.js';
import { CONTROL_API_CSRF_HEADER, CONTROL_API_AUTH_HEADER } from '@devmirror/shared';

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
      controlToken: 'test-control-secret-token'
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

  it('should permit requests from allowed origins (localhost and extensions)', async () => {
    const localhostRes = await controlApi.fastify.inject({
      method: 'GET',
      url: '/health',
      headers: {
        host: '127.0.0.1:4100',
        origin: 'http://localhost:4100'
      }
    });
    expect(localhostRes.statusCode).toBe(200);

    const extRes = await controlApi.fastify.inject({
      method: 'GET',
      url: '/health',
      headers: {
        host: '127.0.0.1:4100',
        origin: 'chrome-extension://abcdefghijklmnopqrstuvwxyz'
      }
    });
    expect(extRes.statusCode).toBe(200);
  });

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

  it('should create and retrieve session when CSRF header is provided', async () => {
    const createRes = await controlApi.fastify.inject({
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

    expect(createRes.statusCode).toBe(200);
    const createBody = JSON.parse(createRes.body);
    expect(createBody.success).toBe(true);
    expect(createBody.session.target.port).toBe(5173);

    // Get session
    const getRes = await controlApi.fastify.inject({
      method: 'GET',
      url: '/api/v1/session',
      headers: { host: '127.0.0.1:4100' }
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = JSON.parse(getRes.body);
    expect(getBody.session.target.port).toBe(5173);
    // Raw token must never be present
    expect(getBody.session.token).toBeUndefined();

    // Revoke session
    const deleteRes = await controlApi.fastify.inject({
      method: 'DELETE',
      url: '/api/v1/session',
      headers: {
        host: '127.0.0.1:4100',
        [CONTROL_API_CSRF_HEADER]: '1'
      }
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(JSON.parse(deleteRes.body).success).toBe(true);

    // After revoke, GET session returns 404
    const getAfterRevoke = await controlApi.fastify.inject({
      method: 'GET',
      url: '/api/v1/session',
      headers: { host: '127.0.0.1:4100' }
    });
    expect(getAfterRevoke.statusCode).toBe(404);
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
        target: { port: 80 } // privileged port
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
        target: { port: 8080, host: '169.254.169.254' } // AWS metadata SSRF attempt
      }
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain('must be 127.0.0.1 or localhost');
  });
});
