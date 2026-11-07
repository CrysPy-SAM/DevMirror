import { describe, it, expect, afterEach } from 'vitest';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { WebSocket } from 'ws';
import { LanProxyServer } from '../src/proxy/server.js';
import { SessionManager } from '../src/session/manager.js';
import { SESSION_COOKIE_NAME, SESSION_QUERY_PARAM } from '@devmirror/shared';

describe('Genuine Real Vite Dev Server Integration', () => {
  let viteServer: ViteDevServer;
  let proxyServer: LanProxyServer;
  let sessionManager: SessionManager;

  afterEach(async () => {
    if (proxyServer && proxyServer.running) {
      await proxyServer.stop();
    }
    if (viteServer) {
      await viteServer.close();
    }
  });

  it('should successfully proxy real Vite HTML, @vite/client, and real Vite HMR WebSocket connection', async () => {
    sessionManager = new SessionManager();

    // 1. Launch a genuine programmatic Vite 6/5 development server
    viteServer = await createViteServer({
      configFile: false,
      root: process.cwd(),
      server: {
        host: '127.0.0.1',
        port: 0,
        strictPort: false,
        allowedHosts: true
      },
      logLevel: 'silent'
    });

    await viteServer.listen();
    const resolvedAddress = viteServer.httpServer?.address();
    expect(resolvedAddress).toBeDefined();
    const targetPort = typeof resolvedAddress === 'object' && resolvedAddress ? resolvedAddress.port : 5173;

    // 2. Launch DevMirror LAN proxy targeting the real Vite server
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
    const proxyPort = proxyServer.assignedPort;

    const session = sessionManager.createSession({
      target: { host: '127.0.0.1', port: targetPort, framework: 'vite', isHttps: false },
      lanIp: '127.0.0.1',
      proxyPort,
      controlPort: 4100
    });

    // 3. Verify HTTP request to real Vite runtime through DevMirror
    const clientJsRes = await fetch(`http://127.0.0.1:${proxyPort}/@vite/client`, {
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${session.token}`
      }
    });

    expect(clientJsRes.status).toBe(200);
    const clientJs = await clientJsRes.text();
    // Genuine Vite client runtime contains Vite HMR client logic
    expect(clientJs).toContain('[vite]');

    // 3.5 Test direct client
    const directClient = new WebSocket(`ws://127.0.0.1:${targetPort}/`, ['vite-hmr']);
    await new Promise<void>((resolve) => directClient.on('open', () => { directClient.close(); resolve(); }));

    // 4. Test connecting through DevMirror to Vite and receiving real HMR events
    const hmrWsUrl = `ws://127.0.0.1:${proxyPort}/?${SESSION_QUERY_PARAM}=${session.token}`;
    const wsClient = new WebSocket(hmrWsUrl, ['vite-hmr'], {
      origin: `http://127.0.0.1:${proxyPort}`
    });

    const receivedMessages: any[] = [];
    await new Promise<void>((resolve, reject) => {
      wsClient.on('message', (raw) => {
        const payload = JSON.parse(raw.toString());
        receivedMessages.push(payload);

        // When real Vite confirms connection, send custom HMR update via Vite server API
        if (payload.type === 'connected') {
          viteServer.hot.send({
            type: 'update',
            updates: [
              {
                type: 'js-update',
                path: '/src/main.tsx',
                acceptedPath: '/src/main.tsx',
                timestamp: Date.now()
              }
            ]
          });
        }

        if (payload.type === 'update') {
          wsClient.close();
          resolve();
        }
      });

      wsClient.on('error', (err) => reject(err));
      setTimeout(() => reject(new Error('Vite HMR event loop timed out')), 3000);
    });

    expect(receivedMessages.length).toBeGreaterThanOrEqual(2);
    expect(receivedMessages[0].type).toBe('connected');
    expect(receivedMessages[1].type).toBe('update');
    expect(receivedMessages[1].updates[0].path).toBe('/src/main.tsx');
  });
});
