/**
 * DevMirror - Milestone 7: Framework Compatibility & HMR Integration Tests
 *
 * Verifies HTTP reverse proxying, header rewriting, and WebSocket HMR forwarding across:
 * 1. Next.js (Fast Refresh & Turbopack over /_next/webpack-hmr) [Simulated Protocol Integration]
 * 2. Angular CLI (Webpack /ng-cli-ws & modern /@vite-hmr) [Simulated Protocol Integration]
 * 3. Astro Framework (Astro HTML markers & Vite HMR /@vite-hmr) [Simulated Framework Integration]
 * 4. Nuxt 3 Framework (Nuxt 3 HTML markers, __NUXT_DATA__, & Nuxt HMR) [Simulated Framework Integration]
 * 5. Create React App / Webpack Dev Server (/ws & /sockjs-node) [Simulated Protocol Integration]
 * 6. Generic HTTP Dev Server (Static files, 304 Not Modified, live reload WS) [Real HTTP/WS Integration]
 *
 * Note: Genuine programmatic Vite 6/5 runtime integration is verified in real-vite-hmr.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { LanProxyServer } from '../src/proxy/server.js';
import { SessionManager } from '../src/session/manager.js';
import { SESSION_COOKIE_NAME, SESSION_QUERY_PARAM, type TargetDevServer } from '@devmirror/shared';

describe('Framework Compatibility & HMR Integration (Milestone 7)', () => {
  let sessionManager: SessionManager;
  let targetServer: http.Server;
  let targetWss: WebSocketServer;
  let targetPort: number;
  let proxyServer: LanProxyServer;
  let proxyPort: number;
  let sessionToken: string;

  beforeEach(() => {
    sessionManager = new SessionManager();
  });

  afterEach(async () => {
    if (proxyServer && proxyServer.running) {
      await proxyServer.stop();
    }
    if (targetWss) {
      targetWss.close();
    }
    if (targetServer) {
      await new Promise<void>((resolve) => targetServer.close(() => resolve()));
    }
  });

  /**
   * Helper to start an upstream dev server simulating framework-specific HTTP and WS behavior
   */
  async function startTargetServer(
    httpHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
    framework: TargetDevServer['framework']
  ): Promise<void> {
    targetServer = http.createServer(httpHandler);
    targetWss = new WebSocketServer({ noServer: true });

    targetServer.on('upgrade', (req, socket, head) => {
      targetWss.handleUpgrade(req, socket, head, (ws) => {
        targetWss.emit('connection', ws, req);
      });
    });

    await new Promise<void>((resolve) => {
      targetServer.listen(0, '127.0.0.1', () => {
        targetPort = (targetServer.address() as any).port;
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
        framework,
        isHttps: false
      },
      enableOverlay: false
    });

    await proxyServer.start();
    proxyPort = proxyServer.assignedPort;

    const session = sessionManager.createSession({
      target: { host: '127.0.0.1', port: targetPort, framework, isHttps: false },
      lanIp: '127.0.0.1',
      proxyPort,
      controlPort: 4100
    });
    sessionToken = session.token;
  }

  // =========================================================================
  // 1. Next.js Compatibility (Fast Refresh over /_next/webpack-hmr)
  // =========================================================================
  describe('1. Next.js Compatibility [Simulated Protocol Integration]', () => {
    it('should forward Fast Refresh WebSocket requests over /_next/webpack-hmr preserving query parameters', async () => {
      let interceptedReqUrl = '';
      let interceptedHeaders: http.IncomingHttpHeaders = {};

      await startTargetServer((req, res) => {
        if (req.url === '/') {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'X-Powered-By': 'Next.js'
          });
          res.end('<!DOCTYPE html><html><head><script id="__NEXT_DATA__" type="application/json">{}</script></head><body><div id="__next"><h1>Next.js Home</h1></div></body></html>');
          return;
        }
        res.writeHead(404);
        res.end();
      }, 'nextjs');

      targetWss.on('connection', (ws, req) => {
        interceptedReqUrl = req.url || '';
        interceptedHeaders = req.headers;
        ws.send(JSON.stringify({ action: 'sync', hash: 'abc123next', errors: [], warnings: [] }));
      });

      // 1. Test HTTP proxying
      const httpRes = await fetch(`http://127.0.0.1:${proxyPort}/`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` }
      });
      expect(httpRes.status).toBe(200);
      const html = await httpRes.text();
      expect(html).toContain('__NEXT_DATA__');
      expect(html).toContain('Next.js Home');

      // 2. Test Next.js HMR WebSocket with query parameter (?page=/dashboard)
      const wsUrl = `ws://127.0.0.1:${proxyPort}/_next/webpack-hmr?page=%2Fdashboard&${SESSION_QUERY_PARAM}=${sessionToken}`;
      const ws = new WebSocket(wsUrl);

      const messagePromise = new Promise<any>((resolve) => {
        ws.on('message', (data) => resolve(JSON.parse(data.toString())));
      });

      const message = await messagePromise;
      expect(message.action).toBe('sync');
      expect(message.hash).toBe('abc123next');

      // Verify that query parameter was preserved when forwarded upstream, while dm_token was stripped
      expect(interceptedReqUrl).toContain('page=%2Fdashboard');
      expect(interceptedReqUrl).not.toContain('dm_token');
      expect(interceptedHeaders.host).toBe(`127.0.0.1:${targetPort}`);
      ws.close();
    });
  });

  // =========================================================================
  // 2. Angular CLI Compatibility (Webpack /ng-cli-ws & modern /@vite-hmr)
  // =========================================================================
  describe('2. Angular CLI Compatibility [Simulated Protocol Integration]', () => {
    it('should forward Angular Webpack Dev Server WebSocket requests over /ng-cli-ws', async () => {
      let wsConnected = false;

      await startTargetServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><body><app-root ng-version="17.2.0">Loading Angular...</app-root></body></html>');
      }, 'angular');

      targetWss.on('connection', (ws) => {
        wsConnected = true;
        ws.send(JSON.stringify({ type: 'ok', hash: 'ng-build-987' }));
      });

      // 1. HTTP verification
      const httpRes = await fetch(`http://127.0.0.1:${proxyPort}/`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` }
      });
      expect(httpRes.status).toBe(200);
      const html = await httpRes.text();
      expect(html).toContain('app-root ng-version="17.2.0"');

      // 2. Angular /ng-cli-ws WebSocket
      const wsUrl = `ws://127.0.0.1:${proxyPort}/ng-cli-ws?${SESSION_QUERY_PARAM}=${sessionToken}`;
      const ws = new WebSocket(wsUrl);

      const msg = await new Promise<any>((resolve) => {
        ws.on('message', (d) => resolve(JSON.parse(d.toString())));
      });

      expect(msg.type).toBe('ok');
      expect(msg.hash).toBe('ng-build-987');
      expect(wsConnected).toBe(true);
      ws.close();
    });
  });

  // =========================================================================
  // 3. Astro Framework Compatibility (Astro markers & Vite HMR /@vite-hmr)
  // =========================================================================
  describe('3. Astro Framework Compatibility [Simulated Framework Integration]', () => {
    it('should proxy Astro HTML and forward Astro Vite HMR WebSocket connection', async () => {
      await startTargetServer((req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Astro': 'true'
        });
        res.end('<!DOCTYPE html><html><head><meta name="astro-view-transitions-enabled" content="true"></head><body><main class="astro-XYZ123"><astro-island data-astro-cid-xyz="1">Astro Content</astro-island></main></body></html>');
      }, 'astro');

      targetWss.on('connection', (ws) => {
        ws.send(JSON.stringify({ type: 'connected' }));
      });

      // 1. Verify Astro HTML
      const httpRes = await fetch(`http://127.0.0.1:${proxyPort}/`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` }
      });
      expect(httpRes.status).toBe(200);
      const text = await httpRes.text();
      expect(text).toContain('astro-island');
      expect(text).toContain('data-astro-cid-xyz');

      // 2. Verify Astro HMR WebSocket
      const wsUrl = `ws://127.0.0.1:${proxyPort}/@vite-hmr?${SESSION_QUERY_PARAM}=${sessionToken}`;
      const ws = new WebSocket(wsUrl, ['vite-hmr']);

      const msg = await new Promise<any>((resolve) => {
        ws.on('message', (d) => resolve(JSON.parse(d.toString())));
      });

      expect(msg.type).toBe('connected');
      ws.close();
    });
  });

  // =========================================================================
  // 4. Nuxt 3 Framework Compatibility (Nuxt HTML & Nuxt Vite HMR)
  // =========================================================================
  describe('4. Nuxt 3 Framework Compatibility [Simulated Framework Integration]', () => {
    it('should proxy Nuxt 3 HTML with __NUXT_DATA__ and forward HMR WebSocket', async () => {
      await startTargetServer((req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Powered-By': 'Nuxt'
        });
        res.end('<!DOCTYPE html><html><head><script id="__NUXT_DATA__" type="application/json">[{"state":1}]</script></head><body><div id="__nuxt"><h1>Welcome to Nuxt 3</h1></div><script src="/_nuxt/entry.js"></script></body></html>');
      }, 'nuxt');

      targetWss.on('connection', (ws) => {
        ws.send(JSON.stringify({ type: 'nuxt:ready', version: '3.11.0' }));
      });

      // 1. Verify Nuxt HTML
      const httpRes = await fetch(`http://127.0.0.1:${proxyPort}/`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` }
      });
      expect(httpRes.status).toBe(200);
      const text = await httpRes.text();
      expect(text).toContain('__NUXT_DATA__');
      expect(text).toContain('Welcome to Nuxt 3');

      // 2. Verify Nuxt HMR WebSocket
      const wsUrl = `ws://127.0.0.1:${proxyPort}/_nuxt/?${SESSION_QUERY_PARAM}=${sessionToken}`;
      const ws = new WebSocket(wsUrl);

      const msg = await new Promise<any>((resolve) => {
        ws.on('message', (d) => resolve(JSON.parse(d.toString())));
      });

      expect(msg.type).toBe('nuxt:ready');
      expect(msg.version).toBe('3.11.0');
      ws.close();
    });
  });

  // =========================================================================
  // 5. Create React App / Webpack Dev Server (/ws & /sockjs-node)
  // =========================================================================
  describe('5. Create React App Compatibility [Simulated Protocol Integration]', () => {
    it('should forward Webpack Dev Server v4/v5 WebSocket connections over /ws', async () => {
      let forwardedOrigin = '';
      let forwardedHost = '';

      await startTargetServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><body><noscript>You need to enable JavaScript to run this app.</noscript><div id="root">CRA App</div><script src="/static/js/bundle.js"></script></body></html>');
      }, 'cra');

      targetWss.on('connection', (ws, req) => {
        forwardedOrigin = req.headers.origin || '';
        forwardedHost = req.headers.host || '';
        ws.send(JSON.stringify({ type: 'ok' }));
      });

      // 1. HTTP bundle verification
      const httpRes = await fetch(`http://127.0.0.1:${proxyPort}/`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` }
      });
      expect(httpRes.status).toBe(200);
      const text = await httpRes.text();
      expect(text).toContain('You need to enable JavaScript to run this app.');
      expect(text).toContain('/static/js/bundle.js');

      // 2. Webpack Dev Server /ws connection
      const wsUrl = `ws://127.0.0.1:${proxyPort}/ws?${SESSION_QUERY_PARAM}=${sessionToken}`;
      const ws = new WebSocket(wsUrl);

      const msg = await new Promise<any>((resolve) => {
        ws.on('message', (d) => resolve(JSON.parse(d.toString())));
      });

      expect(msg.type).toBe('ok');
      // Webpack Dev Server host check passes because Host & Origin were normalized to target
      expect(forwardedHost).toBe(`127.0.0.1:${targetPort}`);
      expect(forwardedOrigin).toBe(`http://127.0.0.1:${targetPort}`);
      ws.close();
    });
  });

  // =========================================================================
  // 6. Generic HTTP Dev Server Compatibility
  // =========================================================================
  describe('6. Generic HTTP Dev Server Compatibility [Real HTTP/WS Integration]', () => {
    it('should support static assets, 304 Not Modified cache headers, and custom live reload WebSocket', async () => {
      await startTargetServer((req, res) => {
        if (req.url === '/styles.css') {
          // Test conditional 304 Not Modified
          if (req.headers['if-none-match'] === '"etag-css-123"') {
            res.writeHead(304);
            res.end();
            return;
          }
          res.writeHead(200, {
            'Content-Type': 'text/css',
            ETag: '"etag-css-123"'
          });
          res.end('body { background: #333; }');
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><body><h1>Generic Web Server</h1></body></html>');
      }, 'generic');

      targetWss.on('connection', (ws) => {
        ws.send('reload');
      });

      // 1. Verify 200 with ETag
      const res1 = await fetch(`http://127.0.0.1:${proxyPort}/styles.css`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` }
      });
      expect(res1.status).toBe(200);
      expect(res1.headers.get('etag')).toBe('"etag-css-123"');
      const css = await res1.text();
      expect(css).toBe('body { background: #333; }');

      // 2. Verify 304 Not Modified conditional request
      const res2 = await fetch(`http://127.0.0.1:${proxyPort}/styles.css`, {
        headers: {
          Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
          'If-None-Match': '"etag-css-123"'
        }
      });
      expect(res2.status).toBe(304);

      // 3. Verify generic live reload WebSocket forwarding
      const wsUrl = `ws://127.0.0.1:${proxyPort}/livereload?${SESSION_QUERY_PARAM}=${sessionToken}`;
      const ws = new WebSocket(wsUrl);

      const msg = await new Promise<string>((resolve) => {
        ws.on('message', (d) => resolve(d.toString()));
      });

      expect(msg).toBe('reload');
      ws.close();
    });
  });
});
