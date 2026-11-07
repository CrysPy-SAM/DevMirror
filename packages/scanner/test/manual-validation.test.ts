import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import { DevServerScanner, validateServer } from '../src/index.js';
import { TEST_TLS_KEY, TEST_TLS_CERT } from './fixtures/tls.js';

describe('Manual Server Validation', () => {
  let testServer: http.Server;
  let testPort: number;
  let scanner: DevServerScanner;

  beforeEach(async () => {
    scanner = new DevServerScanner();

    testServer = http.createServer((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Powered-By': 'Next.js'
      });
      res.end('<html><head><title>Validated Server</title></head><body><div id="__next"></div></body></html>');
    });

    await new Promise<void>((resolve) => {
      testServer.listen(0, '127.0.0.1', () => {
        testPort = (testServer.address() as any).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => testServer.close(() => resolve()));
  });

  it('should validate an active server and return full descriptor', async () => {
    const server = await scanner.validate('127.0.0.1', testPort, {
      includeProcessInfo: false,
      timeoutMs: 1000
    });

    expect(server).not.toBeNull();
    expect(server?.host).toBe('127.0.0.1');
    expect(server?.port).toBe(testPort);
    expect(server?.url).toBe(`http://127.0.0.1:${testPort}`);
    expect(server?.framework).toBe('nextjs');
    expect(server?.frameworkName).toBe('Next.js');
    expect(server?.title).toBe('Validated Server');
    expect(server?.status).toBe('online');
    expect(server?.confidence).toBe('high');
  });

  it('should work via the convenience function validateServer', async () => {
    const server = await validateServer('127.0.0.1', testPort, {
      includeProcessInfo: false,
      timeoutMs: 1000
    });

    expect(server).not.toBeNull();
    expect(server?.framework).toBe('nextjs');
  });

  it('should return null when port is unreachable', async () => {
    const closedPort = 65430;
    const server = await scanner.validate('127.0.0.1', closedPort, {
      includeProcessInfo: false,
      timeoutMs: 200
    });

    expect(server).toBeNull();
  });

  it('should reject invalid port numbers', async () => {
    await expect(scanner.validate('127.0.0.1', 0)).rejects.toThrow('Invalid port');
    await expect(scanner.validate('127.0.0.1', -1)).rejects.toThrow('Invalid port');
    await expect(scanner.validate('127.0.0.1', 65536)).rejects.toThrow('Invalid port');
    await expect(scanner.validate('127.0.0.1', 3000.5)).rejects.toThrow('Invalid port');
  });

  it('should reject forbidden external hosts, metadata endpoints, and malformed inputs', async () => {
    await expect(scanner.validate('8.8.8.8', 80)).rejects.toThrow('Forbidden host');
    await expect(scanner.validate('example.com', 80)).rejects.toThrow('Forbidden host');
    await expect(scanner.validate('169.254.169.254', 80)).rejects.toThrow('Forbidden host');
    await expect(scanner.validate('::ffff:169.254.169.254', 80)).rejects.toThrow('Forbidden host');
    await expect(scanner.validate('http://127.0.0.1', 80)).rejects.toThrow('Forbidden host');
    await expect(scanner.validate('127.0.0.1/path', 80)).rejects.toThrow('Forbidden host');
    await expect(scanner.validate('0177.0.0.1', 80)).rejects.toThrow('Forbidden host');
  });

  it('should support IPv4-mapped IPv6 loopback addresses', async () => {
    const server = await scanner.validate('::ffff:127.0.0.1', testPort, {
      includeProcessInfo: false,
      timeoutMs: 1000
    });

    expect(server).not.toBeNull();
    expect(server?.framework).toBe('nextjs');
  });

  describe('HTTPS validation behavior', () => {
    let httpsServer: https.Server;
    let httpsPort: number;

    beforeEach(async () => {
      httpsServer = https.createServer(
        {
          key: TEST_TLS_KEY,
          cert: TEST_TLS_CERT
        },
        (_req, res) => {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            Server: 'vite/5.1.0'
          });
          res.end('<html><head><script type="module" src="/@vite/client"></script></head><body>Vite</body></html>');
        }
      );

      await new Promise<void>((resolve) => {
        httpsServer.listen(0, '127.0.0.1', () => {
          httpsPort = (httpsServer.address() as any).port;
          resolve();
        });
      });
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => httpsServer.close(() => resolve()));
    });

    it('should reject self-signed HTTPS server by default', async () => {
      const server = await scanner.validate('127.0.0.1', httpsPort, {
        includeProcessInfo: false,
        timeoutMs: 500,
        allowInsecureCertificates: false // default
      });

      // Strict validation fails without throwing unhandled exceptions
      expect(server).toBeNull();
    });

    it('should validate self-signed HTTPS server when allowInsecureCertificates is true', async () => {
      const server = await scanner.validate('127.0.0.1', httpsPort, {
        includeProcessInfo: false,
        timeoutMs: 500,
        allowInsecureCertificates: true
      });

      expect(server).not.toBeNull();
      expect(server?.isHttps).toBe(true);
      expect(server?.framework).toBe('vite');
      expect(server?.confidence).toBe('high');
    });
  });
});
