import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { DevServerScanner, validateServer } from '../src/index.js';

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
    // Pick an unlikely open port
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

  it('should reject forbidden external hosts and cloud metadata endpoints', async () => {
    await expect(scanner.validate('8.8.8.8', 80)).rejects.toThrow('Forbidden host');
    await expect(scanner.validate('example.com', 80)).rejects.toThrow('Forbidden host');
    await expect(scanner.validate('169.254.169.254', 80)).rejects.toThrow('Forbidden host');
  });
});
