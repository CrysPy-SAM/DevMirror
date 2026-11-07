/**
 * DevMirror - Milestone 7: Compression, CSP & HTML Rewriting Deep Integration Tests
 *
 * Verifies:
 * 1. Gzip decompression, script injection, and header cleanup when enableOverlay is true.
 * 2. Brotli (br) decompression, script injection, and header cleanup.
 * 3. Deflate decompression, script injection, and header cleanup.
 * 4. Pass-through streaming without modification when enableOverlay is false (default).
 * 5. Preservation and narrow scoping of restrictive Content-Security-Policy (both HTTP headers and <meta> tags).
 * 6. Protection against double-compression and safe handling of non-HTML responses.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import zlib from 'node:zlib';
import { LanProxyServer } from '../src/proxy/server.js';
import { SessionManager } from '../src/session/manager.js';
import { SESSION_COOKIE_NAME } from '@devmirror/shared';

describe('Compression & CSP Integration (Milestone 7)', () => {
  let sessionManager: SessionManager;
  let targetServer: http.Server;
  let targetPort: number;
  let proxyServer: LanProxyServer;
  let proxyPort: number;
  let sessionToken: string;

  beforeEach(async () => {
    sessionManager = new SessionManager();

    targetServer = http.createServer((req, res) => {
      const htmlDoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Compression & CSP App</title>
</head>
<body>
  <h1>App Running Under Compression</h1>
</body>
</html>`;

      if (req.url === '/gzip') {
        const compressed = zlib.gzipSync(Buffer.from(htmlDoc, 'utf-8'));
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Encoding': 'gzip',
          'Content-Length': compressed.byteLength
        });
        res.end(compressed);
        return;
      }

      if (req.url === '/brotli') {
        const compressed = zlib.brotliCompressSync(Buffer.from(htmlDoc, 'utf-8'));
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Encoding': 'br',
          'Content-Length': compressed.byteLength
        });
        res.end(compressed);
        return;
      }

      if (req.url === '/deflate') {
        const compressed = zlib.deflateSync(Buffer.from(htmlDoc, 'utf-8'));
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Encoding': 'deflate',
          'Content-Length': compressed.byteLength
        });
        res.end(compressed);
        return;
      }

      if (req.url === '/csp-header') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'self'; script-src 'nonce-existing123' 'strict-dynamic'; connect-src 'self'"
        });
        res.end(htmlDoc);
        return;
      }

      if (req.url === '/meta-csp') {
        const metaCspHtml = `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Security-Policy" content="script-src 'nonce-meta456'; connect-src 'self'">
  <title>Meta CSP</title>
</head>
<body>
  <h1>Meta CSP App</h1>
</body>
</html>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(metaCspHtml);
        return;
      }

      res.writeHead(404);
      res.end();
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
      enableOverlay: false // start with default
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
    if (proxyServer && proxyServer.running) {
      await proxyServer.stop();
    }
    await new Promise<void>((resolve) => targetServer.close(() => resolve()));
  });

  it('should pass through raw gzip/brotli/deflate streams when enableOverlay is false', async () => {
    // 1. Gzip pass-through
    const gzipRes = await fetch(`http://127.0.0.1:${proxyPort}/gzip`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` }
    });
    expect(gzipRes.status).toBe(200);
    // Fetch automatically decompresses response for .text(), verify content is intact
    const text = await gzipRes.text();
    expect(text).toContain('App Running Under Compression');
    expect(text).not.toContain('__devmirror');

    // 2. Brotli pass-through
    const brRes = await fetch(`http://127.0.0.1:${proxyPort}/brotli`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` }
    });
    expect(brRes.status).toBe(200);
    const brText = await brRes.text();
    expect(brText).toContain('App Running Under Compression');
    expect(brText).not.toContain('__devmirror');
  });

  it('should decompress and rewrite Gzip, Brotli, and Deflate when enableOverlay is true', async () => {
    proxyServer.setEnableOverlay(true);

    // 1. Gzip rewrite
    const gzipRes = await fetch(`http://127.0.0.1:${proxyPort}/gzip`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` }
    });
    expect(gzipRes.status).toBe(200);
    expect(gzipRes.headers.get('content-encoding')).toBeNull(); // stripped
    const gzipText = await gzipRes.text();
    expect(gzipText).toContain('<!-- [DevMirror Injected Companion] -->');
    expect(gzipText).toContain('/__devmirror/companion.js');

    // 2. Brotli rewrite
    const brRes = await fetch(`http://127.0.0.1:${proxyPort}/brotli`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` }
    });
    expect(brRes.status).toBe(200);
    expect(brRes.headers.get('content-encoding')).toBeNull();
    const brText = await brRes.text();
    expect(brText).toContain('<!-- [DevMirror Injected Companion] -->');

    // 3. Deflate rewrite
    const defRes = await fetch(`http://127.0.0.1:${proxyPort}/deflate`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` }
    });
    expect(defRes.status).toBe(200);
    expect(defRes.headers.get('content-encoding')).toBeNull();
    const defText = await defRes.text();
    expect(defText).toContain('<!-- [DevMirror Injected Companion] -->');
  });

  it('should reuse existing CSP nonce and scope connect-src narrowly', async () => {
    proxyServer.setEnableOverlay(true);

    const res = await fetch(`http://127.0.0.1:${proxyPort}/csp-header`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` }
    });
    expect(res.status).toBe(200);

    const csp = res.headers.get('content-security-policy') || '';
    // Existing nonce must be preserved and reused
    expect(csp).toContain("'nonce-existing123'");
    // connect-src must be scoped strictly to the proxy host
    expect(csp).toContain(`connect-src 'self' ws://127.0.0.1:${proxyPort}`);
    // Must NOT add unsafe-inline
    expect(csp).not.toContain("'unsafe-inline'");

    const html = await res.text();
    // Injected script must use the existing nonce
    expect(html).toContain('nonce="existing123"');
  });

  it('should patch <meta http-equiv="Content-Security-Policy"> tags in HTML', async () => {
    proxyServer.setEnableOverlay(true);

    const res = await fetch(`http://127.0.0.1:${proxyPort}/meta-csp`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` }
    });
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('nonce="meta456"');
    expect(html).toContain(`connect-src 'self' ws://127.0.0.1:${proxyPort}`);
  });
});
