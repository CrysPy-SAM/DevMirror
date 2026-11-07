import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { LanProxyServer } from '../src/proxy/server.js';
import { SessionManager } from '../src/session/manager.js';
import { SESSION_COOKIE_NAME, SESSION_QUERY_PARAM } from '@devmirror/shared';

describe('LanProxyServer', () => {
  let sessionManager: SessionManager;
  let targetServer: http.Server;
  let targetPort: number;
  let proxyServer: LanProxyServer;
  let proxyPort: number;
  let lastTargetRequestHeaders: http.IncomingHttpHeaders = {};

  beforeEach(async () => {
    sessionManager = new SessionManager();

    // 1. Create a mock target dev server
    targetServer = http.createServer((req, res) => {
      lastTargetRequestHeaders = req.headers;
      if (req.url === '/data') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Hello from mock dev server', query: req.url }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Mock App</h1>');
    });

    await new Promise<void>((resolve) => {
      targetServer.listen(0, '127.0.0.1', () => {
        targetPort = (targetServer.address() as any).port;
        resolve();
      });
    });

    // 2. Start LanProxyServer on ephemeral port
    proxyPort = targetPort + 100;
    proxyServer = new LanProxyServer({
      port: proxyPort,
      host: '127.0.0.1',
      sessionManager,
      target: {
        host: '127.0.0.1',
        port: targetPort,
        framework: 'vite',
        isHttps: false
      }
    });

    await proxyServer.start();
  });

  afterEach(async () => {
    if (proxyServer.running) {
      await proxyServer.stop();
    }
    await new Promise<void>((resolve) => targetServer.close(() => resolve()));
  });

  it('should reject unauthenticated requests with 401 Unauthorized', async () => {
    // No session created yet
    const res = await fetch(`http://127.0.0.1:${proxyPort}/`);
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).toContain('Access Denied');
  });

  it('should accept valid ?dm_token, set cookie, and redirect 302 to clean URL', async () => {
    const session = sessionManager.createSession({
      target: { host: '127.0.0.1', port: targetPort, framework: 'vite', isHttps: false },
      lanIp: '127.0.0.1',
      proxyPort,
      controlPort: 4100
    });

    // Request without following redirect
    const res = await fetch(`http://127.0.0.1:${proxyPort}/data?${SESSION_QUERY_PARAM}=${session.token}`, {
      redirect: 'manual'
    });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/data');
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=${session.token}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
  });

  it('should forward request to target dev server when session cookie is provided', async () => {
    const session = sessionManager.createSession({
      target: { host: '127.0.0.1', port: targetPort, framework: 'vite', isHttps: false },
      lanIp: '127.0.0.1',
      proxyPort,
      controlPort: 4100
    });

    const res = await fetch(`http://127.0.0.1:${proxyPort}/data`, {
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${session.token}`,
        'User-Agent': 'MobileTestClient/1.0'
      }
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toBe('Hello from mock dev server');

    // Verify header normalization: Host rewritten to target dev server
    expect(lastTargetRequestHeaders.host).toBe(`127.0.0.1:${targetPort}`);
    expect(lastTargetRequestHeaders['x-forwarded-host']).toBe(`127.0.0.1:${proxyPort}`);
  });

  it('should return 502 Bad Gateway when upstream target dev server is stopped', async () => {
    const session = sessionManager.createSession({
      target: { host: '127.0.0.1', port: targetPort, framework: 'vite', isHttps: false },
      lanIp: '127.0.0.1',
      proxyPort,
      controlPort: 4100
    });

    // Close upstream target server
    await new Promise<void>((resolve) => targetServer.close(() => resolve()));

    const res = await fetch(`http://127.0.0.1:${proxyPort}/data`, {
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${session.token}`
      }
    });

    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain('502 Bad Gateway');
  });
});
