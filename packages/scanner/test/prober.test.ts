import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { PortProber, MAX_BODY_SNIPPET_BYTES } from '../src/prober/port-prober.js';

describe('PortProber', () => {
  let prober: PortProber;
  let testServer: http.Server;
  let testPort: number;

  beforeEach(async () => {
    prober = new PortProber();
    testServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Prober Test Server</h1>');
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

  it('should detect open and closed ports accurately', async () => {
    const openRes = await prober.isPortOpen('127.0.0.1', testPort, 300);
    expect(openRes).toBe(true);

    // Pick an unlikely open port
    const closedRes = await prober.isPortOpen('127.0.0.1', 65432, 100);
    expect(closedRes).toBe(false);
  });

  it('should probe HTTP server and collect headers and body snippet', async () => {
    const probe = await prober.probePort('127.0.0.1', testPort, 500);

    expect(probe.isOpen).toBe(true);
    expect(probe.isHttp).toBe(true);
    expect(probe.statusCode).toBe(200);
    expect(probe.headers).toBeDefined();
    expect(probe.headers!['content-type']).toBe('text/html');
    expect(probe.bodySnippet).toBe('<h1>Prober Test Server</h1>');
  });

  it('should validate allowed hosts and reject external or metadata addresses', () => {
    expect(PortProber.isAllowedHost('127.0.0.1')).toBe(true);
    expect(PortProber.isAllowedHost('localhost')).toBe(true);
    expect(PortProber.isAllowedHost('192.168.1.50')).toBe(true);
    expect(PortProber.isAllowedHost('10.0.0.1')).toBe(true);
    expect(PortProber.isAllowedHost('172.20.0.1')).toBe(true);

    expect(PortProber.isAllowedHost('8.8.8.8')).toBe(false);
    expect(PortProber.isAllowedHost('169.254.169.254')).toBe(false);
    expect(PortProber.isAllowedHost('evil.com')).toBe(false);
  });

  it('should throw when probing invalid port or forbidden host', async () => {
    await expect(prober.probePort('127.0.0.1', 0)).rejects.toThrow('Invalid port');
    await expect(prober.probePort('127.0.0.1', 70000)).rejects.toThrow('Invalid port');
    await expect(prober.probePort('169.254.169.254', 80)).rejects.toThrow('Forbidden host');
  });

  it('should cap body inspection to 64KB for safety', async () => {
    const largeServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      // Send 128KB of data
      res.end('A'.repeat(MAX_BODY_SNIPPET_BYTES * 2));
    });

    await new Promise<void>((resolve) => {
      largeServer.listen(0, '127.0.0.1', () => resolve());
    });
    const largePort = (largeServer.address() as any).port;

    const probe = await prober.probePort('127.0.0.1', largePort, 500);
    expect(probe.bodySnippet).toBeDefined();
    expect(Buffer.byteLength(probe.bodySnippet!)).toBeLessThanOrEqual(MAX_BODY_SNIPPET_BYTES);

    await new Promise<void>((resolve) => largeServer.close(() => resolve()));
  });

  it('should scan multiple ports concurrently', async () => {
    const portsToScan = [testPort, 65431, 65432];
    const results = await prober.scanPorts('127.0.0.1', portsToScan, 200, 5);

    expect(results.length).toBeGreaterThanOrEqual(1);
    const openProbe = results.find((r) => r.port === testPort);
    expect(openProbe).toBeDefined();
    expect(openProbe?.isOpen).toBe(true);
  });
});
