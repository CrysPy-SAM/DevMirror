import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import zlib from 'node:zlib';
import { LanProxyServer } from '../src/proxy/server.js';
import { SessionManager } from '../src/session/manager.js';
import { SESSION_COOKIE_NAME } from '@devmirror/shared';

describe('LanProxyServer - HTML Rewriting & Pass-through', () => {
  let sessionManager: SessionManager;
  let targetServer: http.Server;
  let targetPort: number;
  let proxyServer: LanProxyServer;
  let proxyPort: number;
  let sessionToken: string;

  beforeEach(async () => {
    sessionManager = new SessionManager();

    targetServer = http.createServer((req, res) => {
      if (req.url === '/gzip-page') {
        const html = '<html><head><title>Gzip Target</title></head><body><h1>Gzip Content</h1></body></html>';
        const compressed = zlib.gzipSync(Buffer.from(html, 'utf-8'));
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Encoding': 'gzip',
          'Content-Length': compressed.byteLength
        });
        res.end(compressed);
        return;
      }

      if (req.url === '/plain-page') {
        const html = '<html><head><title>Plain Target</title></head><body><h1>Plain Content</h1></body></html>';
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(html)
        });
        res.end(html);
        return;
      }

      if (req.url === '/app.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end('console.log("hello app");');
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
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
        framework: 'vite',
        isHttps: false
      },
      enableOverlay: false // Default must be false!
    });

    await proxyServer.start();
    proxyPort = proxyServer.assignedPort;

    const session = sessionManager.createSession({
      target: { host: '127.0.0.1', port: targetPort, framework: 'vite', isHttps: false },
      lanIp: '127.0.0.1',
      proxyPort,
      controlPort: 4100
    });
    sessionToken = session.token;
  });

  afterEach(async () => {
    if (proxyServer.running) {
      await proxyServer.stop();
    }
    await new Promise<void>((resolve) => targetServer.close(() => resolve()));
  });

  it('should stream exact raw HTML with zero modifications when enableOverlay is false', async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/plain-page`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` }
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('<html><head><title>Plain Target</title></head><body><h1>Plain Content</h1></body></html>');
    expect(text).not.toContain('__devmirror');
  });

  it('should inject companion script before </head> when enableOverlay is true', async () => {
    proxyServer.setEnableOverlay(true);

    const res = await fetch(`http://127.0.0.1:${proxyPort}/plain-page`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` }
    });

    expect(res.status).toBe(200);
    const text = await res.text();

    expect(text).toContain('<!-- [DevMirror Injected Companion] -->');
    expect(text).toContain('window.__DEVMIRROR__ = Object.freeze({"proxyPort":' + proxyPort + ',"targetPort":' + targetPort + ',"framework":"vite"});');
    expect(text).toContain('<script src="/__devmirror/companion.js" defer></script>');
    expect(text.indexOf('__devmirror/companion.js')).toBeLessThan(text.indexOf('</head>'));
  });

  it('should decompress gzip HTML and inject companion when enableOverlay is true', async () => {
    proxyServer.setEnableOverlay(true);

    const res = await fetch(`http://127.0.0.1:${proxyPort}/gzip-page`, {
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
        'Accept-Encoding': 'gzip, deflate, br'
      }
    });

    expect(res.status).toBe(200);
    const text = await res.text();

    expect(text).toContain('Gzip Content');
    expect(text).toContain('__devmirror/companion.js');
    expect(res.headers.get('content-encoding')).toBeNull(); // stripped
  });

  it('should not modify non-HTML assets (e.g. JS files) even when enableOverlay is true', async () => {
    proxyServer.setEnableOverlay(true);

    const res = await fetch(`http://127.0.0.1:${proxyPort}/app.js`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` }
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('console.log("hello app");');
    expect(text).not.toContain('__devmirror');
  });
});
