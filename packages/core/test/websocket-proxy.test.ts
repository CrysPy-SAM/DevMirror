import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { LanProxyServer } from '../src/proxy/server.js';
import { SessionManager } from '../src/session/manager.js';
import { SESSION_COOKIE_NAME, SESSION_QUERY_PARAM } from '@devmirror/shared';

describe('WebSocket Proxy', () => {
  let sessionManager: SessionManager;
  let targetHttpServer: http.Server;
  let targetWsServer: WebSocketServer;
  let targetPort: number;
  let proxyServer: LanProxyServer;
  let proxyPort: number;

  beforeEach(async () => {
    sessionManager = new SessionManager();

    // 1. Create target dev server with WebSocket server attached
    targetHttpServer = http.createServer((req, res) => {
      res.writeHead(200);
      res.end('OK');
    });

    targetWsServer = new WebSocketServer({ server: targetHttpServer });
    targetWsServer.on('connection', (ws, req) => {
      ws.on('message', (msg) => {
        // Echo message back with prefix
        ws.send(`echo:${msg.toString()}`);
      });
    });

    await new Promise<void>((resolve) => {
      targetHttpServer.listen(0, '127.0.0.1', () => {
        targetPort = (targetHttpServer.address() as any).port;
        resolve();
      });
    });

    // 2. Start LanProxyServer on ephemeral port
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
  });

  afterEach(async () => {
    if (proxyServer.running) {
      await proxyServer.stop();
    }
    targetWsServer.close();
    await new Promise<void>((resolve) => targetHttpServer.close(() => resolve()));
  });

  it('should reject unauthorized WebSocket upgrade requests (401 Unauthorized)', async () => {
    const wsUrl = `ws://127.0.0.1:${proxyPort}/`;

    await expect(
      new Promise((resolve, reject) => {
        const client = new WebSocket(wsUrl);
        client.on('open', () => {
          client.close();
          resolve(true);
        });
        client.on('error', (err) => {
          reject(err);
        });
      })
    ).rejects.toThrow();
  });

  it('should reject WebSocket upgrade with invalid external Origin (403 Forbidden)', async () => {
    const session = sessionManager.createSession({
      target: { host: '127.0.0.1', port: targetPort, framework: 'vite', isHttps: false },
      lanIp: '127.0.0.1',
      proxyPort,
      controlPort: 4100
    });

    const wsUrl = `ws://127.0.0.1:${proxyPort}/?${SESSION_QUERY_PARAM}=${session.token}`;

    await expect(
      new Promise((resolve, reject) => {
        const client = new WebSocket(wsUrl, {
          origin: 'http://malicious-website.com'
        });
        client.on('open', () => {
          client.close();
          resolve(true);
        });
        client.on('error', (err) => {
          reject(err);
        });
      })
    ).rejects.toThrow();
  });

  it('should authenticate and forward WebSocket messages bidirectionally via query token', async () => {
    const session = sessionManager.createSession({
      target: { host: '127.0.0.1', port: targetPort, framework: 'vite', isHttps: false },
      lanIp: '127.0.0.1',
      proxyPort,
      controlPort: 4100
    });

    const wsUrl = `ws://127.0.0.1:${proxyPort}/@vite-hmr?${SESSION_QUERY_PARAM}=${session.token}`;

    const receivedMessage = await new Promise<string>((resolve, reject) => {
      const client = new WebSocket(wsUrl, {
        origin: `http://127.0.0.1:${proxyPort}`
      });

      client.on('open', () => {
        client.send('ping-devmirror');
      });

      client.on('message', (data) => {
        const msg = data.toString();
        client.close();
        resolve(msg);
      });

      client.on('error', (err) => {
        reject(err);
      });
    });

    expect(receivedMessage).toBe('echo:ping-devmirror');
  });

  it('should authenticate and forward WebSocket messages via session cookie', async () => {
    const session = sessionManager.createSession({
      target: { host: '127.0.0.1', port: targetPort, framework: 'vite', isHttps: false },
      lanIp: '127.0.0.1',
      proxyPort,
      controlPort: 4100
    });

    const wsUrl = `ws://127.0.0.1:${proxyPort}/`;

    const receivedMessage = await new Promise<string>((resolve, reject) => {
      const client = new WebSocket(wsUrl, {
        headers: {
          Cookie: `${SESSION_COOKIE_NAME}=${session.token}`
        },
        origin: `http://127.0.0.1:${proxyPort}`
      });

      client.on('open', () => {
        client.send('cookie-auth-success');
      });

      client.on('message', (data) => {
        const msg = data.toString();
        client.close();
        resolve(msg);
      });

      client.on('error', (err) => {
        reject(err);
      });
    });

    expect(receivedMessage).toBe('echo:cookie-auth-success');
  });

  it('should cleanly terminate and destroy active sockets on server shutdown', async () => {
    const session = sessionManager.createSession({
      target: { host: '127.0.0.1', port: targetPort, framework: 'vite', isHttps: false },
      lanIp: '127.0.0.1',
      proxyPort,
      controlPort: 4100
    });

    const wsUrl = `ws://127.0.0.1:${proxyPort}/?${SESSION_QUERY_PARAM}=${session.token}`;
    const client = new WebSocket(wsUrl);

    await new Promise<void>((resolve) => {
      client.on('open', () => resolve());
    });

    expect(proxyServer.activeSocketCount).toBeGreaterThan(0);

    const closePromise = new Promise<void>((resolve) => {
      client.on('close', () => resolve());
    });

    // Stop proxy server
    await proxyServer.stop();
    await closePromise;

    expect(proxyServer.activeSocketCount).toBe(0);
  });
});
