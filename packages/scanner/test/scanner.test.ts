import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { DevServerScanner } from '../src/scanner.js';
import type { DiscoveredDevServer } from '@devmirror/shared';

describe('DevServerScanner', () => {
  let viteServer: http.Server;
  let nextServer: http.Server;
  let staticServer: http.Server;

  let vitePort: number;
  let nextPort: number;
  let staticPort: number;

  beforeEach(async () => {
    // 1. Vite Mock Server
    viteServer = http.createServer((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        Server: 'vite/5.0.0'
      });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>My Vite React App</title>
            <script type="module" src="/@vite/client"></script>
          </head>
          <body><div id="root"></div></body>
        </html>
      `);
    });

    // 2. Next.js Mock Server
    nextServer = http.createServer((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Powered-By': 'Next.js'
      });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>My Next.js Portal</title></head>
          <body>
            <div id="__next"></div>
            <script id="__NEXT_DATA__" type="application/json">{}</script>
          </body>
        </html>
      `);
    });

    // 3. Static/Generic Server
    staticServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE html><html><head><title>Static Documentation</title></head><body>Docs</body></html>');
    });

    await Promise.all([
      new Promise<void>((resolve) => viteServer.listen(0, '127.0.0.1', () => {
        vitePort = (viteServer.address() as any).port;
        resolve();
      })),
      new Promise<void>((resolve) => nextServer.listen(0, '127.0.0.1', () => {
        nextPort = (nextServer.address() as any).port;
        resolve();
      })),
      new Promise<void>((resolve) => staticServer.listen(0, '127.0.0.1', () => {
        staticPort = (staticServer.address() as any).port;
        resolve();
      }))
    ]);
  });

  afterEach(async () => {
    await Promise.all([
      new Promise<void>((resolve) => viteServer.close(() => resolve())),
      new Promise<void>((resolve) => nextServer.close(() => resolve())),
      new Promise<void>((resolve) => staticServer.close(() => resolve()))
    ]);
  });

  it('should scan specific ports and fingerprint frameworks correctly', async () => {
    const scanner = new DevServerScanner();
    const discovered = await scanner.scan({
      host: '127.0.0.1',
      ports: [vitePort, nextPort, staticPort],
      includeProcessInfo: false,
      timeoutMs: 500
    });

    expect(discovered.length).toBe(3);

    const vite = discovered.find((s) => s.port === vitePort);
    expect(vite).toBeDefined();
    expect(vite?.framework).toBe('vite');
    expect(vite?.frameworkName).toBe('Vite');
    expect(vite?.title).toBe('My Vite React App');
    expect(vite?.confidence).toBe('high');
    expect(vite?.url).toBe(`http://127.0.0.1:${vitePort}`);

    const next = discovered.find((s) => s.port === nextPort);
    expect(next).toBeDefined();
    expect(next?.framework).toBe('nextjs');
    expect(next?.frameworkName).toBe('Next.js');
    expect(next?.title).toBe('My Next.js Portal');
    expect(next?.confidence).toBe('high');

    const generic = discovered.find((s) => s.port === staticPort);
    expect(generic).toBeDefined();
    expect(generic?.framework).toBe('generic');
    expect(generic?.confidence).toBe('low');
    expect(generic?.title).toBe('Static Documentation');
  });

  it('should sort discovered servers by confidence descending, then port ascending', async () => {
    const scanner = new DevServerScanner();
    const discovered = await scanner.scan({
      ports: [staticPort, vitePort, nextPort],
      includeProcessInfo: false,
      timeoutMs: 500
    });

    // High confidence servers (Vite, Next.js) should appear before low confidence (Generic)
    expect(discovered[0].confidence).toBe('high');
    expect(discovered[1].confidence).toBe('high');
    expect(discovered[2].confidence).toBe('low');
    expect(discovered[2].framework).toBe('generic');
  });

  it('should support scanning port ranges', async () => {
    const scanner = new DevServerScanner();
    const minPort = Math.min(vitePort, nextPort);
    const maxPort = Math.max(vitePort, nextPort);

    // If difference is small enough, scan the range
    if (maxPort - minPort <= 50) {
      const discovered = await scanner.scan({
        portRange: { start: minPort, end: maxPort },
        includeProcessInfo: false,
        timeoutMs: 200,
        concurrency: 20
      });

      const foundVite = discovered.some((s) => s.port === vitePort);
      const foundNext = discovered.some((s) => s.port === nextPort);
      expect(foundVite).toBe(true);
      expect(foundNext).toBe(true);
    } else {
      // Range test with narrow slice around vitePort
      const discovered = await scanner.scan({
        portRange: { start: vitePort, end: vitePort },
        includeProcessInfo: false,
        timeoutMs: 200
      });
      expect(discovered.length).toBe(1);
      expect(discovered[0].port).toBe(vitePort);
    }
  });

  it('should ignore closed ports gracefully', async () => {
    const scanner = new DevServerScanner();
    const closedPort = 65431;
    const discovered = await scanner.scan({
      ports: [vitePort, closedPort],
      includeProcessInfo: false,
      timeoutMs: 200
    });

    expect(discovered.length).toBe(1);
    expect(discovered[0].port).toBe(vitePort);
  });

  it('should ignore self-signed HTTPS servers by default and discover them when allowInsecureCertificates is true', async () => {
    const { TEST_TLS_KEY, TEST_TLS_CERT } = await import('./fixtures/tls.js');
    const https = await import('node:https');

    const httpsServer = https.createServer(
      { key: TEST_TLS_KEY, cert: TEST_TLS_CERT },
      (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html', 'X-Powered-By': 'Next.js' });
        res.end('<html><head><title>Secure Next App</title></head><body><div id="__next"></div></body></html>');
      }
    );

    await new Promise<void>((resolve) => {
      httpsServer.listen(0, '127.0.0.1', () => resolve());
    });
    const httpsPort = (httpsServer.address() as any).port;

    const scanner = new DevServerScanner();

    // Default: strict cert validation, self-signed HTTPS is ignored
    const defaultScan = await scanner.scan({
      ports: [httpsPort],
      includeProcessInfo: false,
      timeoutMs: 300,
      allowInsecureCertificates: false
    });
    expect(defaultScan.length).toBe(0);

    // Opted-in: discovers self-signed HTTPS server
    const optInScan = await scanner.scan({
      ports: [httpsPort],
      includeProcessInfo: false,
      timeoutMs: 300,
      allowInsecureCertificates: true
    });
    expect(optInScan.length).toBe(1);
    expect(optInScan[0].port).toBe(httpsPort);
    expect(optInScan[0].isHttps).toBe(true);
    expect(optInScan[0].framework).toBe('nextjs');

    await new Promise<void>((resolve) => httpsServer.close(() => resolve()));
  });

  describe('Dual-Stack IPv4 / IPv6 and Localhost Scanning', () => {
    it('should discover an IPv6-bound server and bracket IPv6 in URL', async () => {
      const ipv6Vite = http.createServer((_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          Server: 'vite/5.0.0'
        });
        res.end('<html><head><script type="module" src="/@vite/client"></script></head><body>Vite IPv6</body></html>');
      });

      let ipv6Port: number | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          ipv6Vite.listen(0, '::1', () => {
            ipv6Port = (ipv6Vite.address() as any).port;
            resolve();
          });
          ipv6Vite.on('error', (err) => reject(err));
        });
      } catch {
        return; // Skip if IPv6 is disabled in environment
      }

      if (ipv6Port) {
        const scanner = new DevServerScanner();
        // Scanning 127.0.0.1 discovers the server via loopback fallback
        const discovered = await scanner.scan({
          host: '127.0.0.1',
          ports: [ipv6Port],
          includeProcessInfo: false,
          timeoutMs: 500
        });

        expect(discovered.length).toBe(1);
        expect(discovered[0].port).toBe(ipv6Port);
        expect(discovered[0].framework).toBe('vite');
        expect(discovered[0].url).toBe(`http://[::1]:${ipv6Port}`);

        await new Promise<void>((resolve) => ipv6Vite.close(() => resolve()));
      }
    });

    it('should discover dual-stack servers without duplicate entries', async () => {
      const dualStack = http.createServer((_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Powered-By': 'Next.js'
        });
        res.end('<html><head><script id="__NEXT_DATA__" type="application/json">{}</script></head><body>Next Dual</body></html>');
      });

      await new Promise<void>((resolve) => {
        dualStack.listen(0, () => resolve());
      });
      const dualPort = (dualStack.address() as any).port;

      const scanner = new DevServerScanner();
      const discovered = await scanner.scan({
        host: '127.0.0.1',
        ports: [dualPort],
        includeProcessInfo: false,
        timeoutMs: 500
      });

      expect(discovered.length).toBe(1);
      expect(discovered[0].port).toBe(dualPort);
      expect(discovered[0].framework).toBe('nextjs');

      await new Promise<void>((resolve) => dualStack.close(() => resolve()));
    });
  });
});
