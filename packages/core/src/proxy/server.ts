/**
 * @devmirror/core - LAN Reverse Proxy Server
 * Reverse HTTP proxy bound to the LAN interface, enforcing token auth and forwarding to local dev server.
 */

import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import {
  SESSION_COOKIE_NAME,
  SESSION_QUERY_PARAM,
  type TargetDevServer
} from '@devmirror/shared';
import type { SessionManager } from '../session/manager.js';

export interface LanProxyOptions {
  port: number;
  host?: string;
  sessionManager: SessionManager;
  target: TargetDevServer;
}

export class LanProxyServer {
  private readonly port: number;
  private readonly host: string;
  private readonly sessionManager: SessionManager;
  private target: TargetDevServer;
  private server: http.Server | null = null;
  private isRunning: boolean = false;

  constructor(options: LanProxyOptions) {
    this.port = options.port;
    this.host = options.host ?? '0.0.0.0';
    this.sessionManager = options.sessionManager;
    this.target = { ...options.target };
  }

  /**
   * Updates the upstream target dev server dynamically.
   */
  public updateTarget(newTarget: TargetDevServer): void {
    this.target = { ...newTarget };
  }

  /**
   * Parses cookies from raw Cookie header string.
   */
  private parseCookies(cookieHeader: string | undefined): Record<string, string> {
    const list: Record<string, string> = {};
    if (!cookieHeader) return list;

    cookieHeader.split(';').forEach((cookie) => {
      const parts = cookie.split('=');
      const key = parts.shift()?.trim();
      const value = parts.join('=').trim();
      if (key) {
        list[key] = decodeURIComponent(value);
      }
    });

    return list;
  }

  /**
   * Core request dispatcher.
   */
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const clientIp = req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // 1. Check for token in query parameter (?dm_token=...)
    const queryToken = reqUrl.searchParams.get(SESSION_QUERY_PARAM);
    if (queryToken) {
      if (this.sessionManager.validateToken(queryToken)) {
        // Register device
        this.sessionManager.registerDevice({ ip: clientIp, userAgent });

        // Strip the token from query params and 302 redirect with HttpOnly cookie
        reqUrl.searchParams.delete(SESSION_QUERY_PARAM);
        const redirectPath = reqUrl.pathname + reqUrl.search;

        res.writeHead(302, {
          Location: redirectPath.length > 0 ? redirectPath : '/',
          'Set-Cookie': `${SESSION_COOKIE_NAME}=${encodeURIComponent(queryToken)}; Path=/; HttpOnly; SameSite=Lax`,
          'Cache-Control': 'no-store'
        });
        res.end();
        return;
      } else {
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(this.renderUnauthorizedPage('Invalid or expired DevMirror token. Please re-scan the QR code.'));
        return;
      }
    }

    // 2. Check for session cookie
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies[SESSION_COOKIE_NAME];

    if (!sessionCookie || !this.sessionManager.validateCookie(sessionCookie)) {
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.renderUnauthorizedPage('Access Denied: Please scan the DevMirror QR code with your mobile device to connect.'));
      return;
    }

    // Register or update device ping
    this.sessionManager.registerDevice({ ip: clientIp, userAgent });

    // 3. Forward request to target dev server
    this.forwardRequest(req, res, reqUrl);
  }

  /**
   * Forwards HTTP request to upstream target dev server with header normalization.
   */
  private forwardRequest(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): void {
    const isTargetHttps = this.target.isHttps;
    const httpModule = isTargetHttps ? https : http;

    // Prepare normalized headers
    const forwardedHeaders: http.OutgoingHttpHeaders = { ...req.headers };

    // Rewrite Host header to target dev server (satisfies Vite/Webpack host check)
    forwardedHeaders.host = `${this.target.host}:${this.target.port}`;

    // Normalize Origin and Referer if present
    if (forwardedHeaders.origin) {
      forwardedHeaders.origin = `http${isTargetHttps ? 's' : ''}://${this.target.host}:${this.target.port}`;
    }

    if (forwardedHeaders.referer) {
      try {
        const refUrl = new URL(forwardedHeaders.referer as string);
        refUrl.protocol = isTargetHttps ? 'https:' : 'http:';
        refUrl.host = `${this.target.host}:${this.target.port}`;
        forwardedHeaders.referer = refUrl.toString();
      } catch {
        // ignore malformed referer
      }
    }

    // Preserve and inject X-Forwarded headers
    forwardedHeaders['x-forwarded-for'] = req.socket.remoteAddress || '127.0.0.1';
    forwardedHeaders['x-forwarded-host'] = req.headers.host || `${this.host}:${this.port}`;
    forwardedHeaders['x-forwarded-proto'] = 'http';

    const requestOptions: http.RequestOptions = {
      hostname: this.target.host,
      port: this.target.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: req.method,
      headers: forwardedHeaders,
      timeout: 30000
    };

    const upstreamReq = httpModule.request(requestOptions, (upstreamRes) => {
      // Forward status and headers
      res.writeHead(upstreamRes.statusCode || 200, upstreamRes.headers);
      upstreamRes.pipe(res);
    });

    upstreamReq.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          this.renderErrorPage(
            '502 Bad Gateway: Upstream Dev Server Unreachable',
            `Could not connect to target dev server at http://${this.target.host}:${this.target.port}. (${err.message})`
          )
        );
      }
    });

    upstreamReq.on('timeout', () => {
      upstreamReq.destroy();
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(this.renderErrorPage('504 Gateway Timeout', 'Upstream dev server took too long to respond.'));
      }
    });

    // Pipe client request body to upstream
    req.pipe(upstreamReq);
  }

  private renderUnauthorizedPage(message: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DevMirror - Access Denied</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; text-align: center; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 32px 24px; max-width: 400px; }
    h1 { font-size: 20px; color: #f43f5e; margin-top: 0; }
    p { font-size: 14px; color: #94a3b8; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>DevMirror: Authentication Required</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
  }

  private renderErrorPage(title: string, detail: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DevMirror - Error</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; text-align: center; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 32px 24px; max-width: 440px; }
    h1 { font-size: 18px; color: #f59e0b; margin-top: 0; }
    p { font-size: 14px; color: #94a3b8; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${detail}</p>
  </div>
</body>
</html>`;
  }

  /**
   * Starts listening on the configured port and host.
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.once('error', (err) => {
        reject(err);
      });

      this.server.listen(this.port, this.host, () => {
        this.isRunning = true;
        resolve();
      });
    });
  }

  /**
   * Stops the server and frees the port.
   */
  public async stop(): Promise<void> {
    if (!this.isRunning || !this.server) return;

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.isRunning = false;
        this.server = null;
        resolve();
      });
    });
  }

  public get running(): boolean {
    return this.isRunning;
  }

  public get httpServer(): http.Server | null {
    return this.server;
  }
}
