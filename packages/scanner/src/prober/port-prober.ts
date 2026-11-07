/**
 * @devmirror/scanner - Port Prober
 * Fast concurrent TCP and HTTP/HTTPS availability probing with body inspection limits.
 */

import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import type { ProbeResult } from '../types.js';

export const MAX_BODY_SNIPPET_BYTES = 64 * 1024; // Limit to 64KB for safe fingerprinting

export class PortProber {
  /**
   * Validates that a host is a local loopback or safe private network address.
   */
  public static isAllowedHost(host: string): boolean {
    const cleanHost = host.trim().toLowerCase();
    if (cleanHost === '127.0.0.1' || cleanHost === 'localhost' || cleanHost === '::1') {
      return true;
    }
    // Check RFC 1918 private IPv4 ranges
    const parts = cleanHost.split('.').map(Number);
    if (parts.length === 4 && !parts.some(isNaN)) {
      if (parts[0] === 10) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
    }
    return false;
  }

  /**
   * Checks whether a port is open via a fast TCP connect test.
   */
  public async isPortOpen(host: string, port: number, timeoutMs: number = 350): Promise<boolean> {
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
        socket.connect(port, host);
      } catch {
        finish(false);
      }
    });
  }

  /**
   * Sends a lightweight HTTP GET request to check if the open port is an active HTTP(S) server.
   * Collects response headers and an initial body snippet (up to 64KB).
   */
  public async probeHttp(
    host: string,
    port: number,
    timeoutMs: number = 500,
    isHttps: boolean = false
  ): Promise<ProbeResult> {
    const httpModule = isHttps ? https : http;

    return new Promise((resolve) => {
      let resolved = false;

      const finish = (result: ProbeResult) => {
        if (!resolved) {
          resolved = true;
          resolve(result);
        }
      };

      const timer = setTimeout(() => {
        finish({ port, isOpen: true, isHttp: false });
      }, timeoutMs);

      try {
        const req = httpModule.request(
          {
            hostname: host,
            port,
            path: '/',
            method: 'GET',
            headers: {
              Accept: 'text/html,application/xhtml+xml,application/json,*/*',
              'User-Agent': 'DevMirror-Scanner/0.1.0'
            },
            timeout: timeoutMs,
            rejectUnauthorized: false // Dev servers often use self-signed certificates
          },
          (res) => {
            clearTimeout(timer);
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) {
              if (v !== undefined) {
                headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
              }
            }

            const chunks: Buffer[] = [];
            let totalBytes = 0;

            res.on('data', (chunk: Buffer) => {
              if (totalBytes < MAX_BODY_SNIPPET_BYTES) {
                chunks.push(chunk);
                totalBytes += chunk.byteLength;
              }
            });

            res.on('end', () => {
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
            });

            res.on('error', () => {
              finish({ port, isOpen: true, isHttp: true, statusCode: res.statusCode, headers });
            });
          }
        );

        req.on('error', async () => {
          clearTimeout(timer);
          // If plain HTTP fails and we haven't tried HTTPS yet, try HTTPS fallback
          if (!isHttps) {
            try {
              const httpsResult = await this.probeHttp(host, port, timeoutMs, true);
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
   * Probes a single port: first verifies TCP openness, then tests HTTP response.
   */
  public async probePort(host: string, port: number, timeoutMs: number = 350): Promise<ProbeResult> {
    if (port < 1 || port > 65535 || !Number.isInteger(port)) {
      throw new Error(`Invalid port: ${port}. Port must be an integer between 1 and 65535.`);
    }

    if (!PortProber.isAllowedHost(host)) {
      throw new Error(`Forbidden host: ${host}. Scanner only allows loopback and private LAN addresses.`);
    }

    const isOpen = await this.isPortOpen(host, port, timeoutMs);
    if (!isOpen) {
      return { port, isOpen: false, isHttp: false };
    }

    // Port is open: probe HTTP server
    return this.probeHttp(host, port, timeoutMs);
  }

  /**
   * Scans an array of ports concurrently with a concurrency limit.
   */
  public async scanPorts(
    host: string,
    ports: number[],
    timeoutMs: number = 350,
    concurrency: number = 10
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

            const res = await this.probePort(host, port, timeoutMs);
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

