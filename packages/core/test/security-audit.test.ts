import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { LanProxyServer } from '../src/proxy/server.js';
import { SessionManager } from '../src/session/manager.js';
import { SESSION_COOKIE_NAME, SESSION_QUERY_PARAM } from '@devmirror/shared';

describe('Security Audit & Token Leakage Prevention', () => {
  let sessionManager: SessionManager;
  let targetHttpServer: http.Server;
  let targetWsServer: WebSocketServer;
  let targetPort: number;
  let proxyServer: LanProxyServer;
  let proxyPort: number;
  let receivedUpstreamHttpUrl = '';
  let receivedUpstreamHttpHeaders: http.IncomingHttpHeaders = {};
  let receivedUpstreamWsUrl = '';
  let receivedUpstreamWsHeaders: http.IncomingHttpHeaders = {};

  beforeEach(async () => {
    sessionManager = new SessionManager();

    targetHttpServer = http.createServer((req, res) => {
      receivedUpstreamHttpUrl = req.url || '';
      receivedUpstreamHttpHeaders = req.headers;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Upstream App</h1>');
    });

    targetWsServer = new WebSocketServer({ server: targetHttpServer });
    targetWsServer.on('connection', (_ws, req) => {
      receivedUpstreamWsUrl = req.url || '';
      receivedUpstreamWsHeaders = req.headers;
    });

    await new Promise<void>((resolve) => {
      targetHttpServer.listen(0, '127.0.0.1', () => {
        targetPort = (targetHttpServer.address() as any).port;
        resolve();
      });
    });

    proxyServer = new LanProxyServer({
      port: 0,
      host: '127.0.0.1',
      sessionManager,
      target: {
        host: '127.0.0.1',
        port: targetPort,
        framework: 'vite',
        isHttps: false
      },
      enableOverlay: true
    });

    await proxyServer.start();
    proxyPort = proxyServer.assignedPort;
  });

  afterEach(async () => {
    if (proxyServer.running) {
      await proxyServer.stop();
    }
    targetWsServer.close();
    await new Promise<void>((resolve) => targetHttpServer.close(() => resolve()));
  });

  it('must strip ?dm_token from WebSocket URL before forwarding to upstream dev server', async () => {
    const session = sessionManager.createSession({
      target: { host: '127.0.0.1', port: targetPort, framework: 'vite', isHttps: false },
      lanIp: '127.0.0.1',
      proxyPort,
      controlPort: 4100
    });

    const client = new WebSocket(
      `ws://127.0.0.1:${proxyPort}/@vite-hmr?page=/app&${SESSION_QUERY_PARAM}=${session.token}`,
      { origin: `http://127.0.0.1:${proxyPort}` }
    );

    await new Promise<void>((resolve) => {
      client.on('open', () => {
        client.close();
        resolve();
      });
    });

    // The upstream dev server must see the HMR path and query parameters, BUT NOT the secret token
    expect(receivedUpstreamWsUrl).toContain('/@vite-hmr?page=/app');
    expect(receivedUpstreamWsUrl).not.toContain(session.token);
    expect(receivedUpstreamWsUrl).not.toContain(SESSION_QUERY_PARAM);
  });

  it('must strip dm_token from Referer headers before forwarding upstream', async () => {
    const session = sessionManager.createSession({
      target: { host: '127.0.0.1', port: targetPort, framework: 'vite', isHttps: false },
      lanIp: '127.0.0.1',
      proxyPort,
      controlPort: 4100
    });

    const sensitiveReferer = `http://127.0.0.1:${proxyPort}/home?${SESSION_QUERY_PARAM}=${session.token}&user=1`;

    // 1. Test HTTP Referer stripping
    await fetch(`http://127.0.0.1:${proxyPort}/api/test`, {
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${session.token}`,
        Referer: sensitiveReferer
      }
    });

    expect(receivedUpstreamHttpHeaders.referer).toBeDefined();
    expect(receivedUpstreamHttpHeaders.referer).not.toContain(session.token);
    expect(receivedUpstreamHttpHeaders.referer).toContain('user=1');

    // 2. Test WebSocket Referer stripping
    const wsClient = new WebSocket(`ws://127.0.0.1:${proxyPort}/@vite-hmr`, {
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${session.token}`,
        Referer: sensitiveReferer
      },
      origin: `http://127.0.0.1:${proxyPort}`
    });

    await new Promise<void>((resolve) => {
      wsClient.on('open', () => {
        wsClient.close();
        resolve();
      });
    });

    expect(receivedUpstreamWsHeaders.referer).toBeDefined();
    expect(receivedUpstreamWsHeaders.referer).not.toContain(session.token);
  });

  it('must strip ?dm_token from HTTP request URL before forwarding upstream', async () => {
    const session = sessionManager.createSession({
      target: { host: '127.0.0.1', port: targetPort, framework: 'vite', isHttps: false },
      lanIp: '127.0.0.1',
      proxyPort,
      controlPort: 4100
    });

    // Make an authenticated HTTP request with token in query param
    // (Follow redirect to test what upstream received)
    await fetch(`http://127.0.0.1:${proxyPort}/dashboard?filter=active&${SESSION_QUERY_PARAM}=${session.token}`, {
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${session.token}`
      }
    });

    expect(receivedUpstreamHttpUrl).toBe('/dashboard?filter=active');
    expect(receivedUpstreamHttpUrl).not.toContain(session.token);
    expect(receivedUpstreamHttpUrl).not.toContain(SESSION_QUERY_PARAM);
  });

  it('must never expose raw tokens in injected HTML runtime configuration', async () => {
    const session = sessionManager.createSession({
      target: { host: '127.0.0.1', port: targetPort, framework: 'vite', isHttps: false },
      lanIp: '127.0.0.1',
      proxyPort,
      controlPort: 4100
    });

    const res = await fetch(`http://127.0.0.1:${proxyPort}/`, {
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${session.token}`
      }
    });

    const html = await res.text();
    expect(html).toContain('window.__DEVMIRROR__ = Object.freeze');
    // Verify secret token is NOT leaked in client script
    expect(html).not.toContain(session.token);
    expect(html).not.toContain(SESSION_QUERY_PARAM);
  });

  it('must never expose raw tokens in error pages or unauthorized responses', async () => {
    // 1. Invalid token request
    const invalidRes = await fetch(`http://127.0.0.1:${proxyPort}/?${SESSION_QUERY_PARAM}=invalid-hacker-token-12345`);
    expect(invalidRes.status).toBe(401);
    const body = await invalidRes.text();
    expect(body).not.toContain('invalid-hacker-token-12345');

    // 2. Upstream dev server down
    const session = sessionManager.createSession({
      target: { host: '127.0.0.1', port: 12345, framework: 'vite', isHttps: false }, // dead port
      lanIp: '127.0.0.1',
      proxyPort,
      controlPort: 4100
    });
    proxyServer.updateTarget({ host: '127.0.0.1', port: 12345, framework: 'vite', isHttps: false });

    const errorRes = await fetch(`http://127.0.0.1:${proxyPort}/data?${SESSION_QUERY_PARAM}=${session.token}`);
    const errorBody = await errorRes.text();
    expect(errorBody).not.toContain(session.token);
  });
});
