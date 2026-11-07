/**
 * @devmirror/core - LAN Reverse Proxy Server
 * Reverse HTTP and WebSocket proxy bound to the LAN interface, enforcing token auth,
 * HMR protocol forwarding, and optional HTML companion injection.
 */

import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import type { Duplex } from 'node:stream';
import type net from 'node:net';
import {
  SESSION_COOKIE_NAME,
  SESSION_QUERY_PARAM,
  type TargetDevServer
} from '@devmirror/shared';
import type { SessionManager } from '../session/manager.js';
import { HmrRegistry } from '../hmr/registry.js';
import { HtmlRewriter } from '../html/rewriter.js';

export interface LanProxyOptions {
  port: number;
  host?: string;
  sessionManager: SessionManager;
  target: TargetDevServer;
  enableOverlay?: boolean; // Default must be false!
}

export class LanProxyServer {
  private readonly port: number;
  private readonly host: string;
  private readonly sessionManager: SessionManager;
  private readonly hmrRegistry: HmrRegistry;
  private target: TargetDevServer;
  private enableOverlay: boolean;
  private htmlRewriter: HtmlRewriter;

  private server: http.Server | null = null;
  private isRunning: boolean = false;
  private actualPort: number = 0;
  private readonly activeSockets: Set<Duplex | net.Socket> = new Set();

  constructor(options: LanProxyOptions) {
    this.port = options.port;
    this.host = options.host ?? '0.0.0.0';
    this.sessionManager = options.sessionManager;
    this.target = { ...options.target };
    this.enableOverlay = options.enableOverlay ?? false; // Default: false!

    this.hmrRegistry = new HmrRegistry();
    this.htmlRewriter = new HtmlRewriter({
      enableOverlay: this.enableOverlay,
      proxyPort: this.port,
      targetPort: this.target.port,
      framework: this.target.framework
    });
  }

  /**
   * Updates upstream target dev server dynamically.
   */
  public updateTarget(newTarget: TargetDevServer): void {
    this.target = { ...newTarget };
    this.htmlRewriter = new HtmlRewriter({
      enableOverlay: this.enableOverlay,
      proxyPort: this.assignedPort,
      targetPort: this.target.port,
      framework: this.target.framework
    });
  }

  /**
   * Toggles HTML companion overlay injection dynamically.
   */
  public setEnableOverlay(enabled: boolean): void {
    this.enableOverlay = enabled;
    this.htmlRewriter = new HtmlRewriter({
      enableOverlay: this.enableOverlay,
      proxyPort: this.assignedPort,
      targetPort: this.target.port,
      framework: this.target.framework
    });
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
   * Safely strips dm_token from path without re-encoding existing query parameters.
   */
  private stripTokenFromPath(urlPath: string): string {
    const stripped = urlPath
      .replace(new RegExp(`([?&])${SESSION_QUERY_PARAM}=[^&#]*(&|$)`), '$1')
      .replace(/[?&]$/, '');
    return stripped.length > 0 ? stripped : '/';
  }

  /**
   * Core HTTP request dispatcher.
   */
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const clientIp = req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // 1. Check for token in query parameter (?dm_token=...)
    const queryToken = reqUrl.searchParams.get(SESSION_QUERY_PARAM);
    if (queryToken) {
      if (this.sessionManager.validateToken(queryToken)) {
        this.sessionManager.registerDevice({ ip: clientIp, userAgent });

        const redirectPath = this.stripTokenFromPath(req.url || '/');

        res.writeHead(302, {
          Location: redirectPath,
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
    this.forwardHttpRequest(req, res, reqUrl);
  }

  /**
   * Forwards HTTP request to upstream target dev server with optional HTML rewriting.
   */
  private forwardHttpRequest(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): void {
    const isTargetHttps = this.target.isHttps;
    const httpModule = isTargetHttps ? https : http;

    const forwardedHeaders: http.OutgoingHttpHeaders = { ...req.headers };

    // Rewrite Host
    forwardedHeaders.host = `${this.target.host}:${this.target.port}`;

    // Normalize Origin and Referer
    if (forwardedHeaders.origin) {
      forwardedHeaders.origin = `http${isTargetHttps ? 's' : ''}://${this.target.host}:${this.target.port}`;
    }

    if (forwardedHeaders.referer) {
      try {
        const refUrl = new URL(forwardedHeaders.referer as string);
        refUrl.searchParams.delete(SESSION_QUERY_PARAM);
        refUrl.protocol = isTargetHttps ? 'https:' : 'http:';
        refUrl.host = `${this.target.host}:${this.target.port}`;
        forwardedHeaders.referer = refUrl.toString();
      } catch {
        delete forwardedHeaders.referer;
      }
    }

    forwardedHeaders['x-forwarded-for'] = req.socket.remoteAddress || '127.0.0.1';
    forwardedHeaders['x-forwarded-host'] = req.headers.host || `${this.host}:${this.port}`;
    forwardedHeaders['x-forwarded-proto'] = 'http';

    // Strip pairing token from path so it is never forwarded to target dev server
    const sanitizedPath = this.stripTokenFromPath(req.url || '/');

    const requestOptions: http.RequestOptions = {
      hostname: this.target.host,
      port: this.target.port,
      path: sanitizedPath,
      method: req.method,
      headers: forwardedHeaders,
      timeout: 30000
    };

    const upstreamReq = httpModule.request(requestOptions, async (upstreamRes) => {
      const contentType = String(upstreamRes.headers['content-type'] || '').toLowerCase();
      const isHtml = contentType.includes('text/html');

      // If overlay is enabled and response is HTML, buffer and rewrite
      if (this.enableOverlay && isHtml) {
        const chunks: Buffer[] = [];

        upstreamRes.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        upstreamRes.on('end', async () => {
          const rawBuffer = Buffer.concat(chunks);
          const result = await this.htmlRewriter.process(rawBuffer, upstreamRes.headers);

          res.writeHead(upstreamRes.statusCode || 200, result.headers as any);
          res.end(result.body);
        });

        upstreamRes.on('error', (err) => {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.renderErrorPage('502 Bad Gateway', `Error streaming from dev server: ${err.message}`));
          }
        });
      } else {
        // Pure pass-through streaming (fast, zero memory overhead)
        res.writeHead(upstreamRes.statusCode || 200, upstreamRes.headers);
        upstreamRes.pipe(res);
      }
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

    req.pipe(upstreamReq);
  }

  /**
   * Handles HTTP Upgrade requests for WebSocket & HMR connections.
   */
  private handleUpgrade(req: IncomingMessage, clientSocket: Duplex, head: Buffer): void {
    const clientIp = req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // 1. Origin validation: reject arbitrary malicious origins
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      try {
        const originUrl = new URL(origin);
        // Allow loopback, LAN IP, or Chrome Extension
        const isAllowedOrigin =
          originUrl.hostname === '127.0.0.1' ||
          originUrl.hostname === 'localhost' ||
          originUrl.hostname === this.host ||
          origin.startsWith('chrome-extension://') ||
          originUrl.hostname.startsWith('192.168.') ||
          originUrl.hostname.startsWith('10.') ||
          (originUrl.hostname.startsWith('172.') && parseInt(originUrl.hostname.split('.')[1], 10) >= 16);

        if (!isAllowedOrigin) {
          this.rejectWebSocket(clientSocket, 403, 'Forbidden: Invalid WebSocket Origin');
          return;
        }
      } catch {
        this.rejectWebSocket(clientSocket, 403, 'Forbidden: Malformed WebSocket Origin');
        return;
      }
    }

    // 2. Validate Session Authentication
    const queryToken = reqUrl.searchParams.get(SESSION_QUERY_PARAM);
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies[SESSION_COOKIE_NAME];

    const isValidToken = queryToken && this.sessionManager.validateToken(queryToken);
    const isValidCookie = sessionCookie && this.sessionManager.validateCookie(sessionCookie);

    if (!isValidToken && !isValidCookie) {
      this.rejectWebSocket(clientSocket, 401, 'Unauthorized: Valid DevMirror session required');
      return;
    }

    // Update client ping
    this.sessionManager.registerDevice({ ip: clientIp, userAgent });

    // Track active client socket
    this.activeSockets.add(clientSocket);
    clientSocket.once('close', () => this.activeSockets.delete(clientSocket));
    clientSocket.once('error', () => {
      this.activeSockets.delete(clientSocket);
      clientSocket.destroy();
    });

    // 3. Find matching HMR adapter and normalize headers
    const adapter = this.hmrRegistry.findAdapter(req.url || '/', this.target);
    const forwardedHeaders = adapter.normalizeHeaders(req.headers, this.target);

    // Forward required WebSocket upgrade headers
    if (req.headers['sec-websocket-key']) {
      forwardedHeaders['sec-websocket-key'] = req.headers['sec-websocket-key'] as string;
    }
    if (req.headers['sec-websocket-version']) {
      forwardedHeaders['sec-websocket-version'] = req.headers['sec-websocket-version'] as string;
    }
    if (req.headers['sec-websocket-extensions']) {
      forwardedHeaders['sec-websocket-extensions'] = req.headers['sec-websocket-extensions'] as string;
    }
    if (req.headers['sec-websocket-protocol']) {
      forwardedHeaders['sec-websocket-protocol'] = req.headers['sec-websocket-protocol'] as string;
    }

    const isTargetHttps = this.target.isHttps;
    const httpModule = isTargetHttps ? https : http;

    // Sanitize Referer to prevent pairing token leakage
    if (forwardedHeaders.referer) {
      try {
        const refUrl = new URL(forwardedHeaders.referer as string);
        refUrl.searchParams.delete(SESSION_QUERY_PARAM);
        refUrl.protocol = isTargetHttps ? 'https:' : 'http:';
        refUrl.host = `${this.target.host}:${this.target.port}`;
        forwardedHeaders.referer = refUrl.toString();
      } catch {
        delete forwardedHeaders.referer;
      }
    }

    forwardedHeaders['connection'] = 'Upgrade';
    forwardedHeaders['upgrade'] = 'websocket';

    // Strip pairing token from path so it is never forwarded to target dev server
    const sanitizedWsPath = this.stripTokenFromPath(req.url || '/');

    const upstreamReq = httpModule.request({
      hostname: this.target.host,
      port: this.target.port,
      path: sanitizedWsPath,
      method: 'GET',
      headers: forwardedHeaders,
      agent: false,
      timeout: 30000
    });

    upstreamReq.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
      this.activeSockets.add(upstreamSocket);

      upstreamSocket.once('close', () => {
        this.activeSockets.delete(upstreamSocket);
        clientSocket.destroy();
      });

      upstreamSocket.once('error', () => {
        this.activeSockets.delete(upstreamSocket);
        upstreamSocket.destroy();
        clientSocket.destroy();
      });

      // Forward 101 Switching Protocols handshake to client
      let rawHandshake = `HTTP/1.1 101 Switching Protocols\r\n`;
      for (const [key, val] of Object.entries(upstreamRes.headers)) {
        if (Array.isArray(val)) {
          for (const v of val) rawHandshake += `${key}: ${v}\r\n`;
        } else if (val !== undefined) {
          rawHandshake += `${key}: ${val}\r\n`;
        }
      }
      rawHandshake += '\r\n';

      clientSocket.write(rawHandshake);

      if (upstreamHead && upstreamHead.length > 0) {
        clientSocket.write(upstreamHead);
      }
      if (head && head.length > 0) {
        upstreamSocket.write(head);
      }

      // Pipe bidirectionally
      clientSocket.pipe(upstreamSocket);
      upstreamSocket.pipe(clientSocket);
    });

    // Handle non-101 responses from upstream (e.g. upstream rejected upgrade)
    upstreamReq.on('response', (upstreamRes) => {
      let rawResponse = `HTTP/1.1 ${upstreamRes.statusCode || 400} ${upstreamRes.statusMessage || ''}\r\n`;
      for (const [key, val] of Object.entries(upstreamRes.headers)) {
        if (Array.isArray(val)) {
          for (const v of val) rawResponse += `${key}: ${v}\r\n`;
        } else if (val !== undefined) {
          rawResponse += `${key}: ${val}\r\n`;
        }
      }
      rawResponse += '\r\n';
      clientSocket.write(rawResponse);
      clientSocket.destroy();
    });

    upstreamReq.on('error', (err) => {
      this.rejectWebSocket(clientSocket, 502, `Bad Gateway: Target dev server unreachable (${err.message})`);
    });

    upstreamReq.end();
  }

  /**
   * Rejects an unauthenticated or invalid WebSocket upgrade request with HTTP error code and closes socket.
   */
  private rejectWebSocket(socket: Duplex, statusCode: number, reason: string): void {
    const statusText = statusCode === 401 ? 'Unauthorized' : statusCode === 403 ? 'Forbidden' : 'Bad Gateway';
    const response = `HTTP/1.1 ${statusCode} ${statusText}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${reason}`;
    socket.write(response);
    socket.destroy();
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
   * Starts listening on configured port and host.
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      // Handle WebSocket upgrades
      this.server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));

      this.server.once('error', (err) => {
        reject(err);
      });

      this.server.listen(this.port, this.host, () => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') {
          this.actualPort = addr.port;
        } else {
          this.actualPort = this.port;
        }
        this.htmlRewriter = new HtmlRewriter({
          enableOverlay: this.enableOverlay,
          proxyPort: this.actualPort,
          targetPort: this.target.port,
          framework: this.target.framework
        });
        this.isRunning = true;
        resolve();
      });
    });
  }

  /**
   * Stops server, destroys all active sockets, and frees the port.
   */
  public async stop(): Promise<void> {
    if (!this.isRunning || !this.server) return;

    // Destroy all active sockets immediately
    for (const socket of this.activeSockets) {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    }
    this.activeSockets.clear();

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

  public get assignedPort(): number {
    return this.actualPort || this.port;
  }

  public get activeSocketCount(): number {
    return this.activeSockets.size;
  }

  public get isOverlayEnabled(): boolean {
    return this.enableOverlay;
  }
}
