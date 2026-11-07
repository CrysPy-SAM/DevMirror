import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { LanProxyServer } from '../src/proxy/server.js';
import { SessionManager } from '../src/session/manager.js';
import { SESSION_QUERY_PARAM } from '@devmirror/shared';

describe('Framework HMR Integration', () => {
  let targetHttpServer: http.Server;
  let targetWsServer: WebSocketServer;
  let targetPort: number;
  let proxyServer: LanProxyServer;
  let proxyPort: number;
  let sessionManager: SessionManager;

  afterEach(async () => {
    if (proxyServer && proxyServer.running) {
      await proxyServer.stop();
    }
    if (targetWsServer) {
      targetWsServer.close();
    }
    if (targetHttpServer) {
      await new Promise<void>((resolve) => targetHttpServer.close(() => resolve()));
    }
  });

  it('should support Vite HMR protocol over /@vite-hmr with subprotocol negotiation', async () => {
    sessionManager = new SessionManager();
    let receivedSubprotocol = '';
    let receivedHostHeader = '';

    targetHttpServer = http.createServer((req, res) => res.end('Vite App'));
    targetWsServer = new WebSocketServer({
      server: targetHttpServer,
      handleProtocols: (protocols) => {
        if (protocols.has('vite-hmr')) {
          receivedSubprotocol = 'vite-hmr';
          return 'vite-hmr';
        }
        return false;
      }
    });

    targetWsServer.on('connection', (ws, req) => {
      receivedHostHeader = req.headers.host || '';
      // Vite sends connected message
      ws.send(JSON.stringify({ type: 'connected' }));

      ws.on('message', (msg) => {
        const parsed = JSON.parse(msg.toString());
        if (parsed.type === 'custom' && parsed.event === 'file-changed') {
          // Send Vite HMR update payload
          ws.send(
            JSON.stringify({
              type: 'update',
              updates: [
                {
                  type: 'js-update',
                  path: '/src/App.tsx',
                  acceptedPath: '/src/App.tsx',
                  timestamp: Date.now()
                }
              ]
            })
          );
        }
      });
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
      }
    });
    await proxyServer.start();
    proxyPort = proxyServer.assignedPort;

    const session = sessionManager.createSession({
      target: { host: '127.0.0.1', port: targetPort, framework: 'vite', isHttps: false },
      lanIp: '127.0.0.1',
      proxyPort,
      controlPort: 4100
    });

    const client = new WebSocket(
      `ws://127.0.0.1:${proxyPort}/@vite-hmr?${SESSION_QUERY_PARAM}=${session.token}`,
      ['vite-hmr'],
      { origin: `http://127.0.0.1:${proxyPort}` }
    );

    const receivedMessages: any[] = [];
    await new Promise<void>((resolve, reject) => {
      client.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        receivedMessages.push(msg);
        if (msg.type === 'connected') {
          client.send(JSON.stringify({ type: 'custom', event: 'file-changed' }));
        } else if (msg.type === 'update') {
          client.close();
          resolve();
        }
      });
      client.on('error', (err) => reject(err));
    });

    expect(receivedSubprotocol).toBe('vite-hmr');
    expect(receivedHostHeader).toBe(`127.0.0.1:${targetPort}`);
    expect(receivedMessages).toHaveLength(2);
    expect(receivedMessages[0].type).toBe('connected');
    expect(receivedMessages[1].type).toBe('update');
    expect(receivedMessages[1].updates[0].path).toBe('/src/App.tsx');
  });

  it('should support Next.js HMR over /_next/webpack-hmr preserving query parameters', async () => {
    sessionManager = new SessionManager();
    let requestedUrl = '';

    targetHttpServer = http.createServer((req, res) => res.end('Next.js App'));
    targetWsServer = new WebSocketServer({ server: targetHttpServer });

    targetWsServer.on('connection', (ws, req) => {
      requestedUrl = req.url || '';
      // Next.js Fast Refresh action sync
      ws.send(JSON.stringify({ action: 'sync', hash: 'abc123hash', errors: [], warnings: [] }));
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
        framework: 'nextjs',
        isHttps: false
      }
    });
    await proxyServer.start();
    proxyPort = proxyServer.assignedPort;

    const session = sessionManager.createSession({
      target: { host: '127.0.0.1', port: targetPort, framework: 'nextjs', isHttps: false },
      lanIp: '127.0.0.1',
      proxyPort,
      controlPort: 4100
    });

    const client = new WebSocket(
      `ws://127.0.0.1:${proxyPort}/_next/webpack-hmr?page=/dashboard&${SESSION_QUERY_PARAM}=${session.token}`,
      { origin: `http://127.0.0.1:${proxyPort}` }
    );

    const receivedData = await new Promise<any>((resolve, reject) => {
      client.on('message', (data) => {
        client.close();
        resolve(JSON.parse(data.toString()));
      });
      client.on('error', (err) => reject(err));
    });

    expect(requestedUrl).toContain('/_next/webpack-hmr?page=/dashboard');
    expect(receivedData.action).toBe('sync');
    expect(receivedData.hash).toBe('abc123hash');
  });

  it('should support Angular CLI HMR over /ng-cli-ws', async () => {
    sessionManager = new SessionManager();
    let requestedPath = '';

    targetHttpServer = http.createServer((req, res) => res.end('Angular App'));
    targetWsServer = new WebSocketServer({ server: targetHttpServer });

    targetWsServer.on('connection', (ws, req) => {
      requestedPath = req.url || '';
      ws.send(JSON.stringify({ type: 'liveReload', data: { enabled: true } }));
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
        framework: 'angular',
        isHttps: false
      }
    });
    await proxyServer.start();
    proxyPort = proxyServer.assignedPort;

    const session = sessionManager.createSession({
      target: { host: '127.0.0.1', port: targetPort, framework: 'angular', isHttps: false },
      lanIp: '127.0.0.1',
      proxyPort,
      controlPort: 4100
    });

    const client = new WebSocket(
      `ws://127.0.0.1:${proxyPort}/ng-cli-ws?${SESSION_QUERY_PARAM}=${session.token}`,
      { origin: `http://127.0.0.1:${proxyPort}` }
    );

    const receivedData = await new Promise<any>((resolve, reject) => {
      client.on('message', (data) => {
        client.close();
        resolve(JSON.parse(data.toString()));
      });
      client.on('error', (err) => reject(err));
    });

    expect(requestedPath).toContain('/ng-cli-ws');
    expect(receivedData.type).toBe('liveReload');
    expect(receivedData.data.enabled).toBe(true);
  });
});
