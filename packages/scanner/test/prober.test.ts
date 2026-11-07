import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import { PortProber, safeLookup, MAX_BODY_SNIPPET_BYTES } from '../src/prober/port-prober.js';
import { TEST_TLS_KEY, TEST_TLS_CERT } from './fixtures/tls.js';

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

  describe('Host and IP validation (SSRF and metadata protection)', () => {
    it('should allow valid loopback and private LAN addresses', () => {
      // Loopback IPv4
      expect(PortProber.isAllowedHost('127.0.0.1')).toBe(true);
      expect(PortProber.isAllowedHost('127.0.0.2')).toBe(true);
      expect(PortProber.isAllowedHost('127.255.255.254')).toBe(true);
      expect(PortProber.isAllowedHost('localhost')).toBe(true);

      // RFC 1918 Private IPv4
      expect(PortProber.isAllowedHost('10.0.0.1')).toBe(true);
      expect(PortProber.isAllowedHost('10.254.0.1')).toBe(true);
      expect(PortProber.isAllowedHost('172.16.0.1')).toBe(true);
      expect(PortProber.isAllowedHost('172.31.255.254')).toBe(true);
      expect(PortProber.isAllowedHost('192.168.1.1')).toBe(true);
      expect(PortProber.isAllowedHost('192.168.100.50')).toBe(true);

      // IPv6 Loopback & ULA
      expect(PortProber.isAllowedHost('::1')).toBe(true);
      expect(PortProber.isAllowedHost('[::1]')).toBe(true);
      expect(PortProber.isAllowedHost('0:0:0:0:0:0:0:1')).toBe(true);
      expect(PortProber.isAllowedHost('fc00::1')).toBe(true);
      expect(PortProber.isAllowedHost('fd12:3456:789a::1')).toBe(true);

      // IPv4-mapped IPv6
      expect(PortProber.isAllowedHost('::ffff:127.0.0.1')).toBe(true);
      expect(PortProber.isAllowedHost('[::ffff:127.0.0.1]')).toBe(true);
      expect(PortProber.isAllowedHost('::ffff:192.168.1.10')).toBe(true);
    });

    it('should reject cloud metadata endpoints across all IP formats', () => {
      // AWS/GCP/Azure IMDSv4
      expect(PortProber.isAllowedHost('169.254.169.254')).toBe(false);
      expect(PortProber.isAllowedHost('169.254.0.1')).toBe(false);

      // IPv4-mapped IPv6 metadata bypass attempts
      expect(PortProber.isAllowedHost('::ffff:169.254.169.254')).toBe(false);
      expect(PortProber.isAllowedHost('[::ffff:169.254.169.254]')).toBe(false);

      // AWS IMDSv6
      expect(PortProber.isAllowedHost('fd00:ec2::254')).toBe(false);
    });

    it('should reject public IP addresses and arbitrary domain names', () => {
      expect(PortProber.isAllowedHost('8.8.8.8')).toBe(false);
      expect(PortProber.isAllowedHost('1.1.1.1')).toBe(false);
      expect(PortProber.isAllowedHost('93.184.216.34')).toBe(false);
      expect(PortProber.isAllowedHost('::ffff:8.8.8.8')).toBe(false);

      expect(PortProber.isAllowedHost('google.com')).toBe(false);
      expect(PortProber.isAllowedHost('example.com')).toBe(false);
      expect(PortProber.isAllowedHost('evil.local')).toBe(false);
      expect(PortProber.isAllowedHost('localhost.evil.com')).toBe(false);
      expect(PortProber.isAllowedHost('metadata.google.internal')).toBe(false);
    });

    it('should reject reserved, unspecified, broadcast, and malformed inputs', () => {
      expect(PortProber.isAllowedHost('0.0.0.0')).toBe(false);
      expect(PortProber.isAllowedHost('255.255.255.255')).toBe(false);
      expect(PortProber.isAllowedHost('224.0.0.1')).toBe(false); // Multicast
      expect(PortProber.isAllowedHost('100.64.0.1')).toBe(false); // CGNAT

      // URL injection attempts
      expect(PortProber.isAllowedHost('http://127.0.0.1')).toBe(false);
      expect(PortProber.isAllowedHost('127.0.0.1:3000')).toBe(false);
      expect(PortProber.isAllowedHost('127.0.0.1/path')).toBe(false);
      expect(PortProber.isAllowedHost('user@127.0.0.1')).toBe(false);
      expect(PortProber.isAllowedHost('127.0.0.1?query=1')).toBe(false);

      // Octal and hex evasion tricks
      expect(PortProber.isAllowedHost('0177.0.0.1')).toBe(false);
      expect(PortProber.isAllowedHost('0x7f000001')).toBe(false);

      // Empty or invalid strings
      expect(PortProber.isAllowedHost('')).toBe(false);
      expect(PortProber.isAllowedHost('   ')).toBe(false);
    });
  });

  describe('DNS Rebinding Protection (safeLookup)', () => {
    it('should reject connections when DNS resolves to a forbidden IP', async () => {
      await new Promise<void>((resolve, reject) => {
        // Test safeLookup with a host that resolves to a public IP
        safeLookup('8.8.8.8', {}, (err) => {
          try {
            expect(err).toBeDefined();
            expect(err?.message).toContain('DNS Rebinding Protection');
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should allow lookups when resolving to loopback IP', async () => {
      await new Promise<void>((resolve, reject) => {
        safeLookup('127.0.0.1', {}, (err, address) => {
          try {
            expect(err).toBeNull();
            expect(address).toBe('127.0.0.1');
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });
  });

  describe('HTTPS Certificate Validation', () => {
    let httpsServer: https.Server;
    let httpsPort: number;

    beforeEach(async () => {
      httpsServer = https.createServer(
        {
          key: TEST_TLS_KEY,
          cert: TEST_TLS_CERT
        },
        (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Secure Local HTTPS App</h1>');
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

    it('should reject self-signed HTTPS certificates by default', async () => {
      // By default, allowInsecureCertificates is false (strict TLS verification)
      const probe = await prober.probeHttp('127.0.0.1', httpsPort, {
        timeoutMs: 500,
        isHttps: true,
        allowInsecureCertificates: false
      });

      // Strict validation fails because cert is self-signed
      expect(probe.isHttp).toBe(false);
    });

    it('should successfully probe self-signed HTTPS server when explicitly opted in', async () => {
      const probe = await prober.probeHttp('127.0.0.1', httpsPort, {
        timeoutMs: 500,
        isHttps: true,
        allowInsecureCertificates: true
      });

      expect(probe.isHttp).toBe(true);
      expect(probe.isHttps).toBe(true);
      expect(probe.statusCode).toBe(200);
      expect(probe.bodySnippet).toBe('<h1>Secure Local HTTPS App</h1>');
    });
  });

  describe('HTTP Redirect Security', () => {
    it('should block redirects targeting cloud metadata endpoints', async () => {
      const redirectServer = http.createServer((_req, res) => {
        res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
      });

      await new Promise<void>((resolve) => {
        redirectServer.listen(0, '127.0.0.1', () => resolve());
      });
      const redirectPort = (redirectServer.address() as any).port;

      const probe = await prober.probeHttp('127.0.0.1', redirectPort, 500);

      // Verify probe did NOT follow redirect to metadata IP
      expect(probe.statusCode).toBe(302);
      expect(probe.bodySnippet).toContain('Blocked redirect to forbidden host');

      await new Promise<void>((resolve) => redirectServer.close(() => resolve()));
    });

    it('should block redirects targeting external public domains', async () => {
      const redirectServer = http.createServer((_req, res) => {
        res.writeHead(301, { Location: 'https://evil.com/exfiltrate' });
        res.end();
      });

      await new Promise<void>((resolve) => {
        redirectServer.listen(0, '127.0.0.1', () => resolve());
      });
      const redirectPort = (redirectServer.address() as any).port;

      const probe = await prober.probeHttp('127.0.0.1', redirectPort, 500);

      expect(probe.statusCode).toBe(301);
      expect(probe.bodySnippet).toContain('Blocked redirect to forbidden host: evil.com');

      await new Promise<void>((resolve) => redirectServer.close(() => resolve()));
    });

    it('should safely follow internal local redirects to final page', async () => {
      const redirectServer = http.createServer((req, res) => {
        if (req.url === '/') {
          res.writeHead(302, { Location: '/app/dashboard' });
          res.end();
        } else if (req.url === '/app/dashboard') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Dashboard Content</h1>');
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise<void>((resolve) => {
        redirectServer.listen(0, '127.0.0.1', () => resolve());
      });
      const redirectPort = (redirectServer.address() as any).port;

      const probe = await prober.probeHttp('127.0.0.1', redirectPort, 500);

      expect(probe.statusCode).toBe(200);
      expect(probe.bodySnippet).toBe('<h1>Dashboard Content</h1>');

      await new Promise<void>((resolve) => redirectServer.close(() => resolve()));
    });
  });

  describe('Safety limits and error isolation', () => {
    it('should throw when probing invalid port or forbidden host', async () => {
      await expect(prober.probePort('127.0.0.1', 0)).rejects.toThrow('Invalid port');
      await expect(prober.probePort('127.0.0.1', 70000)).rejects.toThrow('Invalid port');
      await expect(prober.probePort('169.254.169.254', 80)).rejects.toThrow('Forbidden host');
    });

    it('should strictly cap body inspection to 64KB for safety without unhandled errors', async () => {
      const largeServer = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
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
});
