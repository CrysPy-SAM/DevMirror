import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { DevMirrorCliRunner } from '../src/runner.js';

describe('DevMirrorCliRunner Lifecycle', () => {
  let targetServer: http.Server;
  let targetPort: number;
  let runner: DevMirrorCliRunner;

  beforeEach(async () => {
    runner = new DevMirrorCliRunner();

    targetServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Vite Dev Server Output</h1>');
    });

    await new Promise<void>((resolve) => {
      targetServer.listen(0, '127.0.0.1', () => {
        targetPort = (targetServer.address() as any).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (runner.running) {
      await runner.stop();
    }
    await new Promise<void>((resolve) => targetServer.close(() => resolve()));
  });

  it('should start engine, generate QR code, and proxy HTTP requests', async () => {
    const result = await runner.start({
      target: {
        host: '127.0.0.1',
        port: targetPort,
        framework: 'vite',
        isHttps: false
      },
      enableKeyboardControls: false
    });

    expect(runner.running).toBe(true);
    expect(result.proxyPort).toBeGreaterThan(0);
    expect(result.controlPort).toBeGreaterThan(0);
    expect(result.previewUrl).toContain(`:${result.proxyPort}/?dm_token=`);
    expect(result.qrCode.length).toBeGreaterThan(20);

    // Test initial pairing request with token -> returns 302 with HttpOnly cookie
    const pairingRes = await new Promise<{
      statusCode?: number;
      headers: http.IncomingHttpHeaders;
    }>((resolve, reject) => {
      http.get(result.previewUrl, (res) => {
        resolve({ statusCode: res.statusCode, headers: res.headers });
      }).on('error', reject);
    });

    expect(pairingRes.statusCode).toBe(302);
    expect(pairingRes.headers['set-cookie']).toBeDefined();
    const cookie = pairingRes.headers['set-cookie']![0];
    expect(cookie).toContain('dm_session=');

    // Test subsequent authenticated request with cookie -> proxies to upstream dev server (200 OK)
    const proxyRes = await new Promise<{ statusCode?: number; body: string }>((resolve, reject) => {
      http.get(
        `http://127.0.0.1:${result.proxyPort}/`,
        { headers: { Cookie: cookie } },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ statusCode: res.statusCode, body }));
        }
      ).on('error', reject);
    });

    expect(proxyRes.statusCode).toBe(200);
    expect(proxyRes.body).toContain('<h1>Vite Dev Server Output</h1>');

    // Clean shutdown
    await runner.stop();
    expect(runner.running).toBe(false);
  });

  it('should support repeated start and stop cycles without port leaks', async () => {
    // Cycle 1
    const r1 = await runner.start({
      target: { host: '127.0.0.1', port: targetPort, framework: 'vite', isHttps: false },
      enableKeyboardControls: false
    });
    expect(runner.running).toBe(true);
    await runner.stop();
    expect(runner.running).toBe(false);

    // Cycle 2
    const r2 = await runner.start({
      target: { host: '127.0.0.1', port: targetPort, framework: 'vite', isHttps: false },
      enableKeyboardControls: false
    });
    expect(runner.running).toBe(true);
    expect(r2.proxyPort).toBe(r1.proxyPort);
    await runner.stop();
    expect(runner.running).toBe(false);
  });

  it('should throw and clean up if already running', async () => {
    await runner.start({
      target: { host: '127.0.0.1', port: targetPort, framework: 'vite', isHttps: false },
      enableKeyboardControls: false
    });

    await expect(
      runner.start({
        target: { host: '127.0.0.1', port: targetPort, framework: 'vite', isHttps: false },
        enableKeyboardControls: false
      })
    ).rejects.toThrow('already running');
  });
});
