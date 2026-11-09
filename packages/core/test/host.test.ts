import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { formatTargetHost, cleanHostName } from '../src/network/host.js';
import { LanProxyServer } from '../src/proxy/server.js';
import { SessionManager } from '../src/session/manager.js';
import { SESSION_COOKIE_NAME } from '@devmirror/shared';

describe('Host & Origin Formatting (IPv4 / IPv6 RFC Compliance)', () => {
  it('should format IPv4, IPv6, and localhost addresses correctly', () => {
    // IPv4
    expect(formatTargetHost('127.0.0.1', 5173)).toBe('127.0.0.1:5173');
    expect(formatTargetHost('192.168.1.50', 3000)).toBe('192.168.1.50:3000');

    // IPv6 (must be enclosed in square brackets per RFC 3986 & RFC 7230)
    expect(formatTargetHost('::1', 5173)).toBe('[::1]:5173');
    expect(formatTargetHost('[::1]', 5173)).toBe('[::1]:5173');
    expect(formatTargetHost('0:0:0:0:0:0:0:1', 5173)).toBe('[0:0:0:0:0:0:0:1]:5173');
    expect(formatTargetHost('2001:db8::1', 8080)).toBe('[2001:db8::1]:8080');
    expect(formatTargetHost('::1')).toBe('[::1]');

    // Localhost and domain names
    expect(formatTargetHost('localhost', 5173)).toBe('localhost:5173');
    expect(formatTargetHost('my-app.local', 4200)).toBe('my-app.local:4200');
  });

  it('should clean host names by stripping brackets for socket connections', () => {
    expect(cleanHostName('[::1]')).toBe('::1');
    expect(cleanHostName('::1')).toBe('::1');
    expect(cleanHostName('127.0.0.1')).toBe('127.0.0.1');
    expect(cleanHostName('localhost')).toBe('localhost');
  });
});

describe('Upstream Host Header Forwarding Integration', () => {
  let sessionManager: SessionManager;
  let targetServer: http.Server;
  let targetPort: number;
  let receivedHeaders: http.IncomingHttpHeaders = {};
  let proxyServer: LanProxyServer;
  let proxyPort: number;
  let sessionCookie: string;

  beforeEach(async () => {
    sessionManager = new SessionManager();

    targetServer = http.createServer((req, res) => {
      receivedHeaders = req.headers;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });

    await new Promise<void>((resolve) => {
      targetServer.listen(0, '127.0.0.1', () => {
        targetPort = (targetServer.address() as any).port;
        resolve();
      });
    });

    // Create session
    const session = sessionManager.createSession({
      target: { host: '127.0.0.1', port: targetPort, framework: 'vite', isHttps: false },
      lanIp: '127.0.0.1',
      proxyPort: 0,
      controlPort: 0
    });
    sessionCookie = `${SESSION_COOKIE_NAME}=${session.token}`;
  });

  afterEach(async () => {
    if (proxyServer && proxyServer.running) {
      await proxyServer.stop();
    }
    await new Promise<void>((resolve) => targetServer.close(() => resolve()));
  });

  it('should forward RFC-compliant Host header and preserve original Host in x-forwarded-host', async () => {
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

    // Simulate request coming from Cloudflare Public Tunnel
    const publicHost = 'test-subdomain-123.trycloudflare.com';
    await new Promise<void>((resolve, reject) => {
      const req = http.get(
        `http://127.0.0.1:${proxyPort}/`,
        {
          headers: {
            Host: publicHost,
            Cookie: sessionCookie,
            'cf-connecting-ip': '203.0.113.195',
            'x-forwarded-proto': 'https'
          }
        },
        (res) => {
          res.resume();
          res.on('end', resolve);
        }
      );
      req.on('error', reject);
    });

    // Upstream dev server must receive target host:port in Host
    expect(receivedHeaders.host).toBe(`127.0.0.1:${targetPort}`);

    // Preserved public tunnel headers
    expect(receivedHeaders['x-forwarded-host']).toBe(publicHost);
    expect(receivedHeaders['x-forwarded-proto']).toBe('https');
    expect(receivedHeaders['x-forwarded-for']).toBe('203.0.113.195');
  });

  it('should format IPv6 target host with brackets in upstream Host and Origin headers', async () => {
    // Create IPv6 target server
    let ipv6TargetHeaders: http.IncomingHttpHeaders = {};
    const ipv6TargetServer = http.createServer((req, res) => {
      ipv6TargetHeaders = req.headers;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });

    let ipv6TargetPort = 0;
    await new Promise<void>((resolve) => {
      ipv6TargetServer.listen(0, '::1', () => {
        ipv6TargetPort = (ipv6TargetServer.address() as any).port;
        resolve();
      });
    });

    // Create session for IPv6 target
    const ipv6Session = sessionManager.createSession({
      target: { host: '::1', port: ipv6TargetPort, framework: 'vite', isHttps: false },
      lanIp: '127.0.0.1',
      proxyPort: 0,
      controlPort: 0
    });
    const ipv6Cookie = `${SESSION_COOKIE_NAME}=${ipv6Session.token}`;

    proxyServer = new LanProxyServer({
      port: 0,
      host: '127.0.0.1',
      sessionManager,
      target: {
        host: '::1',
        port: ipv6TargetPort,
        framework: 'vite',
        isHttps: false
      }
    });

    await proxyServer.start();
    proxyPort = proxyServer.assignedPort;

    await new Promise<void>((resolve, reject) => {
      const req = http.get(
        `http://127.0.0.1:${proxyPort}/api/test`,
        {
          headers: {
            Host: 'devmirror-preview.trycloudflare.com',
            Cookie: ipv6Cookie,
            Origin: 'https://devmirror-preview.trycloudflare.com',
            Referer: 'https://devmirror-preview.trycloudflare.com/app'
          }
        },
        (res) => {
          res.resume();
          res.on('end', resolve);
        }
      );
      req.on('error', reject);
    });

    // Upstream dev server must receive bracketed IPv6 in Host header so Vite does not block it
    expect(ipv6TargetHeaders.host).toBe(`[::1]:${ipv6TargetPort}`);
    expect(ipv6TargetHeaders.origin).toBe(`http://[::1]:${ipv6TargetPort}`);
    expect(ipv6TargetHeaders.referer).toBe(`http://[::1]:${ipv6TargetPort}/app`);
    expect(ipv6TargetHeaders['x-forwarded-host']).toBe('devmirror-preview.trycloudflare.com');

    await new Promise<void>((resolve) => ipv6TargetServer.close(() => resolve()));
  });

  it('should forward bracketed IPv6 Host header on WebSocket HMR upgrade', async () => {
    const { WebSocketServer, WebSocket } = await import('ws');

    let wsReceivedHost = '';
    const ipv6WsHttpServer = http.createServer((req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    const wss = new WebSocketServer({ server: ipv6WsHttpServer });
    wss.on('connection', (_ws, req) => {
      wsReceivedHost = req.headers.host || '';
    });

    let ipv6WsPort = 0;
    await new Promise<void>((resolve) => {
      ipv6WsHttpServer.listen(0, '::1', () => {
        ipv6WsPort = (ipv6WsHttpServer.address() as any).port;
        resolve();
      });
    });

    const ipv6Session = sessionManager.createSession({
      target: { host: '::1', port: ipv6WsPort, framework: 'vite', isHttps: false },
      lanIp: '127.0.0.1',
      proxyPort: 0,
      controlPort: 0
    });
    const ipv6Cookie = `${SESSION_COOKIE_NAME}=${ipv6Session.token}`;

    proxyServer = new LanProxyServer({
      port: 0,
      host: '127.0.0.1',
      sessionManager,
      target: {
        host: '::1',
        port: ipv6WsPort,
        framework: 'vite',
        isHttps: false
      }
    });

    await proxyServer.start();
    proxyPort = proxyServer.assignedPort;

    const ws = new WebSocket(`ws://127.0.0.1:${proxyPort}/`, {
      headers: {
        Cookie: ipv6Cookie,
        Origin: 'https://test-preview.trycloudflare.com',
        Host: 'test-preview.trycloudflare.com'
      }
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.close();
        resolve();
      });
      ws.on('error', reject);
    });

    expect(wsReceivedHost).toBe(`[::1]:${ipv6WsPort}`);

    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => ipv6WsHttpServer.close(() => resolve()));
  });
});
