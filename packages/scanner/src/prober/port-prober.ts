/**
 * @devmirror/scanner - Port Prober
 * Fast concurrent TCP and HTTP/HTTPS availability probing with host validation,
 * DNS rebinding protection, TLS certificate validation, redirect security, and body inspection limits.
 */

import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import type { ProbeResult, ProbeHttpOptions } from '../types.js';

export const MAX_BODY_SNIPPET_BYTES = 64 * 1024; // Limit to 64KB for safe fingerprinting

/**
 * Custom DNS lookup handler enforcing destination IP verification
 * to prevent DNS rebinding attacks while supporting dual-stack ({ all: true }) lookups.
 */
export function safeLookup(
  hostname: string,
  options: any,
  callback?: (err: Error | null, addressOrAddresses: any, family?: number) => void
): void {
  const cb = (typeof options === 'function' ? options : callback) as (
    err: Error | null,
    addressOrAddresses: any,
    family?: number
  ) => void;
  const opts = typeof options === 'object' ? options : {};

  dns.lookup(hostname, opts, (err, addressOrAddresses, family) => {
    if (err) {
      return cb(err, addressOrAddresses, family);
    }

    if (Array.isArray(addressOrAddresses)) {
      // options.all was true: addressOrAddresses is LookupAddress[]
      for (const entry of addressOrAddresses) {
        if (!PortProber.isAllowedIp(entry.address)) {
          const rebindingErr = new Error(
            `DNS Rebinding Protection: host "${hostname}" resolved to forbidden address "${entry.address}". Connection blocked.`
          );
          return cb(rebindingErr, []);
        }
      }
      return cb(null, addressOrAddresses);
    }

    // Single address lookup
    const address = addressOrAddresses as string;
    if (!PortProber.isAllowedIp(address)) {
      const rebindingErr = new Error(
        `DNS Rebinding Protection: host "${hostname}" resolved to forbidden address "${address}". Connection blocked.`
      );
      return cb(rebindingErr, '', family || 4);
    }
    return cb(null, address, family);
  });
}

export class PortProber {
  /**
   * Validates whether an IP address is an authorized local loopback or RFC private LAN address.
   * Explicitly blocks public IPs, cloud metadata endpoints, carrier-grade NAT, multicast, and broadcast.
   */
  public static isAllowedIp(ip: string): boolean {
    let clean = ip.trim().replace(/^\[|\]$/g, '').toLowerCase();

    // Handle IPv4-mapped IPv6 (e.g., ::ffff:127.0.0.1 or ::ffff:192.168.1.1)
    if (clean.startsWith('::ffff:')) {
      const ipv4Part = clean.slice(7);
      if (net.isIPv4(ipv4Part)) {
        clean = ipv4Part;
      } else {
        return false;
      }
    }

    // 1. IPv4 Validation
    if (net.isIPv4(clean)) {
      const parts = clean.split('.').map(Number);
      if (parts.length !== 4 || parts.some(isNaN)) {
        return false;
      }

      // Explicitly reject unspecified (0.0.0.0/8) and broadcast (255.255.255.255)
      if (parts[0] === 0 || clean === '255.255.255.255') {
        return false;
      }

      // Explicitly reject link-local / cloud metadata (169.254.0.0/16)
      // Protects AWS/GCP/Azure/OpenStack 169.254.169.254
      if (parts[0] === 169 && parts[1] === 254) {
        return false;
      }

      // Explicitly reject multicast (224.0.0.0/4)
      if (parts[0] >= 224 && parts[0] <= 239) {
        return false;
      }

      // Explicitly reject Shared Address Space / CGNAT (100.64.0.0/10)
      if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) {
        return false;
      }

      // Explicitly reject Documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24)
      if (
        (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) ||
        (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) ||
        (parts[0] === 203 && parts[1] === 0 && parts[2] === 113)
      ) {
        return false;
      }

      // Allow Loopback: 127.0.0.0/8
      if (parts[0] === 127) {
        return true;
      }

      // Allow RFC 1918 Private IPv4:
      // 10.0.0.0/8
      if (parts[0] === 10) {
        return true;
      }
      // 172.16.0.0/12
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
        return true;
      }
      // 192.168.0.0/16
      if (parts[0] === 192 && parts[1] === 168) {
        return true;
      }

      // Reject all other IPv4 (public addresses)
      return false;
    }

    // 2. IPv6 Validation
    if (net.isIPv6(clean)) {
      // Reject cloud metadata IMDSv6 (fd00:ec2::254)
      if (clean === 'fd00:ec2::254' || clean.includes('fd00:ec2::254')) {
        return false;
      }

      // Reject unspecified (::), multicast (ff00::/8), link-local (fe80::/10)
      if (
        clean === '::' ||
        clean === '0:0:0:0:0:0:0:0' ||
        clean.startsWith('ff') ||
        clean.startsWith('fe8') ||
        clean.startsWith('fe9') ||
        clean.startsWith('fea') ||
        clean.startsWith('feb')
      ) {
        return false;
      }

      // Allow IPv6 Loopback (::1)
      if (
        clean === '::1' ||
        clean === '0:0:0:0:0:0:0:1' ||
        clean === '0000:0000:0000:0000:0000:0000:0000:0001'
      ) {
        return true;
      }

      // Allow IPv6 Unique Local Address (ULA) RFC 4193 (fc00::/7)
      if (/^f[cd][0-9a-f]{2}:/i.test(clean) || /^f[cd]::/i.test(clean)) {
        return true;
      }

      // Reject all other IPv6 (public / global unicast)
      return false;
    }

    return false;
  }

  /**
   * Validates that a host is an authorized local loopback, localhost, or safe private network address.
   * Rejects public IPs, arbitrary domain names, and cloud metadata endpoints.
   */
  public static isAllowedHost(host: string): boolean {
    const clean = host.trim().replace(/^\[|\]$/g, '').toLowerCase();

    // Reject empty or invalid input containing URL schemes, slashes, backslashes, userinfo, query, hash, spaces
    if (!clean || /[\/\s\\@?#]/.test(clean)) {
      return false;
    }

    // Allow literal 'localhost'
    if (clean === 'localhost') {
      return true;
    }

    // Check against authorized IP ranges (loopback & private RFC addresses)
    return PortProber.isAllowedIp(clean);
  }

  /**
   * Identifies whether a host represents a local loopback interface across IPv4 and IPv6.
   */
  public static isLoopbackHost(host: string): boolean {
    const clean = host.trim().replace(/^\[|\]$/g, '').toLowerCase();
    if (clean === 'localhost') return true;
    if (clean === '::1' || clean === '0:0:0:0:0:0:0:1' || clean === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
    if (clean.startsWith('127.')) return true;
    if (clean === '::ffff:127.0.0.1') return true;
    return false;
  }

  /**
   * Checks whether a port is open via a fast TCP connect test with DNS rebinding protection.
   */
  public async isPortOpen(host: string, port: number, timeoutMs: number = 350): Promise<boolean> {
    const cleanHost = host.trim().replace(/^\[|\]$/g, '');

    return new Promise((resolve) => {
      const socket = new net.Socket();
      let resolved = false;

      const finish = (open: boolean) => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve(open);
        }
      };

      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));

      try {
        socket.connect({
          port,
          host: cleanHost,
          lookup: safeLookup
        });
      } catch {
        finish(false);
      }
    });
  }

  /**
   * Sends a lightweight HTTP GET request to inspect headers and body snippets.
   *
   * Security constraints:
   * - rejectUnauthorized is true by default. Self-signed certs require explicit opt-in (allowInsecureCertificates: true).
   * - DNS rebinding protected via safeLookup.
   * - Redirects cannot bypass host restrictions (validated with isAllowedHost).
   * - Body snippets capped at 64KB with clean stream destruction without unhandled errors.
   */
  public async probeHttp(
    host: string,
    port: number,
    optionsOrTimeout: number | ProbeHttpOptions = 500,
    isHttpsFallback: boolean = false
  ): Promise<ProbeResult> {
    const cleanHost = host.trim().replace(/^\[|\]$/g, '');
    const opts: ProbeHttpOptions =
      typeof optionsOrTimeout === 'number'
        ? { timeoutMs: optionsOrTimeout, isHttps: isHttpsFallback }
        : optionsOrTimeout;

    const timeoutMs = opts.timeoutMs ?? 500;
    const isHttps = opts.isHttps ?? false;
    const allowInsecureCertificates = opts.allowInsecureCertificates ?? false;
    const path = opts.path ?? '/';
    const maxRedirects = opts.maxRedirects ?? 3;
    const redirectCount = opts.redirectCount ?? 0;

    const httpModule = isHttps ? https : http;
    const startTime = Date.now();

    return new Promise((resolve) => {
      let resolved = false;

      const finish = (result: ProbeResult) => {
        if (!resolved) {
          resolved = true;
          if (!result.host) {
            result.host = cleanHost;
          }
          resolve(result);
        }
      };

      const timer = setTimeout(() => {
        finish({ port, isOpen: true, isHttp: false, host: cleanHost });
      }, timeoutMs);

      try {
        const req = httpModule.request(
          {
            hostname: cleanHost,
            port,
            path,
            method: 'GET',
            headers: {
              Accept: 'text/html,application/xhtml+xml,application/json,*/*',
              'User-Agent': 'DevMirror-Scanner/0.1.0'
            },
            timeout: timeoutMs,
            // Strict certificate validation enabled by default; opt-in required for self-signed certs
            rejectUnauthorized: !allowInsecureCertificates,
            lookup: safeLookup
          },
          async (res) => {
            clearTimeout(timer);

            // Handle HTTP Redirects (301, 302, 303, 307, 308)
            const isRedirect = res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode);
            const location = res.headers['location'];

            if (isRedirect && location && redirectCount < maxRedirects) {
              let targetUrl: URL;
              try {
                const formattedHost = cleanHost.includes(':') ? `[${cleanHost}]` : cleanHost;
                const currentBase = `${isHttps ? 'https' : 'http'}://${formattedHost}:${port}`;
                targetUrl = new URL(location, currentBase);
              } catch {
                targetUrl = null as any;
              }

              if (targetUrl) {
                // SECURITY: Verify redirect target does not bypass host restrictions
                if (!PortProber.isAllowedHost(targetUrl.hostname)) {
                  // Refuse to follow redirect to forbidden host (e.g. metadata IP or public server)
                  req.destroy();
                  finish({
                    port,
                    isOpen: true,
                    isHttp: true,
                    statusCode: res.statusCode,
                    headers: { location },
                    bodySnippet: `Blocked redirect to forbidden host: ${targetUrl.hostname}`,
                    isHttps
                  });
                  return;
                }

                // Follow redirect within allowed local boundary
                const redirectPort = targetUrl.port
                  ? parseInt(targetUrl.port, 10)
                  : targetUrl.protocol === 'https:'
                    ? 443
                    : 80;

                const remainingTime = Math.max(100, timeoutMs - (Date.now() - startTime));
                req.destroy();

                try {
                  const redirectResult = await this.probeHttp(targetUrl.hostname, redirectPort, {
                    timeoutMs: remainingTime,
                    isHttps: targetUrl.protocol === 'https:',
                    allowInsecureCertificates,
                    path: targetUrl.pathname + targetUrl.search,
                    maxRedirects,
                    redirectCount: redirectCount + 1
                  });
                  finish(redirectResult);
                  return;
                } catch {
                  // Fall through if redirect fetch fails
                }
              }
            }

            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) {
              if (v !== undefined) {
                headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
              }
            }

            const chunks: Buffer[] = [];
            let totalBytes = 0;

            const done = () => {
              if (resolved) return;
              const bodySnippet = Buffer.concat(chunks).toString('utf-8');
              finish({
                port,
                isOpen: true,
                isHttp: true,
                statusCode: res.statusCode,
                headers,
                bodySnippet,
                isHttps
              });
            };

            res.on('data', (chunk: Buffer) => {
              const remaining = MAX_BODY_SNIPPET_BYTES - totalBytes;
              if (remaining > 0) {
                if (chunk.byteLength <= remaining) {
                  chunks.push(chunk);
                  totalBytes += chunk.byteLength;
                } else {
                  chunks.push(chunk.subarray(0, remaining));
                  totalBytes += remaining;
                  // Cap reached: destroy stream cleanly to conserve memory
                  req.destroy();
                  done();
                }
              }
            });

            res.on('end', done);
            res.on('close', done);

            res.on('error', () => {
              if (resolved) return;
              finish({ port, isOpen: true, isHttp: true, statusCode: res.statusCode, headers });
            });
          }
        );

        // Prevent unhandled errors on socket
        req.on('socket', (socket) => {
          socket.on('error', () => {
            // Ignored; handled by req.on('error')
          });
        });

        req.on('error', async () => {
          clearTimeout(timer);
          if (resolved) return;

          // If plain HTTP fails and we haven't tried HTTPS yet, attempt HTTPS fallback
          if (!isHttps) {
            try {
              const httpsResult = await this.probeHttp(host, port, {
                timeoutMs,
                isHttps: true,
                allowInsecureCertificates,
                path
              });
              finish(httpsResult);
              return;
            } catch {
              // ignore
            }
          }
          finish({ port, isOpen: true, isHttp: false });
        });

        req.on('timeout', () => {
          clearTimeout(timer);
          if (resolved) return;
          req.destroy();
          finish({ port, isOpen: true, isHttp: false });
        });

        req.end();
      } catch {
        clearTimeout(timer);
        finish({ port, isOpen: true, isHttp: false });
      }
    });
  }

  /**
   * Probes a single port with dual-stack loopback fallback:
   * 1. Probes the primary target host.
   * 2. If the port is closed and the host is a local loopback (IPv4/IPv6/localhost),
   *    probes the alternate loopback address family (e.g. 127.0.0.1 <-> ::1).
   * 3. Guarantees that dual-stack servers are detected exactly once without duplicates.
   */
  public async probePort(
    host: string,
    port: number,
    timeoutMs: number = 350,
    allowInsecureCertificates: boolean = false
  ): Promise<ProbeResult> {
    if (port < 1 || port > 65535 || !Number.isInteger(port)) {
      throw new Error(`Invalid port: ${port}. Port must be an integer between 1 and 65535.`);
    }

    if (!PortProber.isAllowedHost(host)) {
      throw new Error(`Forbidden host: ${host}. Scanner only allows loopback and private LAN addresses.`);
    }

    const cleanHost = host.trim().replace(/^\[|\]$/g, '');

    // 1. Probe primary host
    const isOpen = await this.isPortOpen(cleanHost, port, timeoutMs);
    if (isOpen) {
      return this.probeHttp(cleanHost, port, {
        timeoutMs,
        allowInsecureCertificates
      });
    }

    // 2. Dual-stack fallback: If primary loopback was closed, probe alternate family
    if (PortProber.isLoopbackHost(cleanHost)) {
      const lower = cleanHost.toLowerCase();
      // If primary was IPv4 (127.0.0.1, etc.) or localhost, probe IPv6 loopback (::1).
      // If primary was IPv6 (::1), probe IPv4 loopback (127.0.0.1).
      const fallbackHost = lower === '::1' || lower === '0:0:0:0:0:0:0:1' ? '127.0.0.1' : '::1';

      const isFallbackOpen = await this.isPortOpen(fallbackHost, port, timeoutMs);
      if (isFallbackOpen) {
        return this.probeHttp(fallbackHost, port, {
          timeoutMs,
          allowInsecureCertificates
        });
      }
    }

    return { port, isOpen: false, isHttp: false };
  }

  /**
   * Scans an array of ports concurrently with a concurrency limit.
   */
  public async scanPorts(
    host: string,
    ports: number[],
    timeoutMs: number = 350,
    concurrency: number = 10,
    allowInsecureCertificates: boolean = false
  ): Promise<ProbeResult[]> {
    const results: ProbeResult[] = [];
    const queue = [...ports];

    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
      workers.push(
        (async () => {
          while (queue.length > 0) {
            const port = queue.shift();
            if (port === undefined) break;

            const res = await this.probePort(host, port, timeoutMs, allowInsecureCertificates);
            if (res.isOpen) {
              results.push(res);
            }
          }
        })()
      );
    }

    await Promise.all(workers);
    return results;
  }
}
