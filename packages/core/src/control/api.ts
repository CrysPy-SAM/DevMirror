/**
 * @devmirror/core - Control API
 * Fastify HTTP server strictly bound to 127.0.0.1 for local management and Chrome Extension IPC.
 * Implements exact extension-origin allowlist validation, strict CORS/CSRF protections,
 * and isolated pairing URL access.
 */

import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import {
  CONTROL_API_AUTH_HEADER,
  CONTROL_API_CSRF_HEADER,
  CONTROL_API_CLI_HEADER,
  DEVMIRROR_DEV_EXTENSION_ID,
  type TargetDevServer,
  type SanitizedSessionInfo
} from '@devmirror/shared';
import type { SessionManager } from '../session/manager.js';

export interface ValidatedOrigin {
  isExtension: boolean;
  isLoopbackWeb: boolean;
  origin: string;
  extensionId?: string;
}

export interface ControlApiOptions {
  port: number;
  sessionManager: SessionManager;
  lanIp: string;
  proxyPort: number;
  controlToken?: string;
  requireAuth?: boolean;
  allowedExtensionIds?: string[];
  onDiscover?: () => Promise<any[]>;
  onTargetChange?: (target: TargetDevServer) => Promise<void> | void;
  onSessionRevoke?: () => Promise<void> | void;
}

export class ControlApi {
  private readonly app: FastifyInstance;
  private readonly port: number;
  private readonly sessionManager: SessionManager;
  private readonly lanIp: string;
  private readonly proxyPort: number;
  private readonly controlToken?: string;
  private readonly requireAuth: boolean;
  private readonly allowedExtensionIds: string[];
  private readonly onDiscover?: () => Promise<any[]>;
  private readonly onTargetChange?: (target: TargetDevServer) => Promise<void> | void;
  private readonly onSessionRevoke?: () => Promise<void> | void;
  private readonly startTime: number;
  private isRunning: boolean = false;
  private actualPort: number = 0;

  constructor(options: ControlApiOptions) {
    this.port = options.port;
    this.sessionManager = options.sessionManager;
    this.lanIp = options.lanIp;
    this.proxyPort = options.proxyPort;
    this.controlToken = options.controlToken;
    this.requireAuth = options.requireAuth ?? false;
    this.onDiscover = options.onDiscover;
    this.onTargetChange = options.onTargetChange;
    this.onSessionRevoke = options.onSessionRevoke;
    this.startTime = Date.now();

    // Build trusted extension ID allowlist (development ID + any configured production/custom IDs)
    const envIds = process.env.DEVMIRROR_ALLOWED_EXTENSION_IDS
      ? process.env.DEVMIRROR_ALLOWED_EXTENSION_IDS.split(',').map((id) => id.trim().toLowerCase())
      : [];

    const customIds = options.allowedExtensionIds
      ? options.allowedExtensionIds.map((id) => id.trim().toLowerCase())
      : [];

    this.allowedExtensionIds = Array.from(
      new Set([DEVMIRROR_DEV_EXTENSION_ID.toLowerCase(), ...envIds, ...customIds])
    );

    this.app = Fastify({
      logger: false
    });

    this.setupSecurityHooks();
    this.setupRoutes();
  }

  /**
   * Validates and parses an incoming Origin header using the URL API.
   * Rejects malformed schemes, credentials, search, hashes, and non-root paths.
   */
  public parseAndValidateOrigin(originStr: string | undefined): ValidatedOrigin | null {
    if (!originStr || typeof originStr !== 'string') return null;

    try {
      const url = new URL(originStr);

      // Origin must have no path other than '' or '/', no query, no hash, no userinfo
      if ((url.pathname !== '' && url.pathname !== '/') || url.search || url.hash || url.username || url.password) {
        return null;
      }

      // 1. Chrome Extension Origin: chrome-extension://<32-char-id>
      if (url.protocol === 'chrome-extension:') {
        const extensionId = url.hostname.toLowerCase();
        // Chrome extension IDs are strictly 32 lowercase letters [a-p]
        if (!/^[a-p]{32}$/.test(extensionId)) {
          return null;
        }

        // Must match our explicit allowlist
        if (!this.allowedExtensionIds.includes(extensionId)) {
          return null;
        }

        return {
          isExtension: true,
          isLoopbackWeb: false,
          origin: `chrome-extension://${extensionId}`,
          extensionId
        };
      }

      // 2. Loopback Web Origin: http(s)://127.0.0.1 or http(s)://localhost
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        const hostname = url.hostname.toLowerCase();
        if (hostname === '127.0.0.1' || hostname === 'localhost') {
          return {
            isExtension: false,
            isLoopbackWeb: true,
            origin: url.origin
          };
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Applies strict Host, Origin, and CSRF validations.
   */
  private setupSecurityHooks(): void {
    // 1. Strict Host header validation (must strictly be 127.0.0.1 or localhost)
    this.app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      const host = request.headers.host;
      if (!host) {
        return reply.status(400).send({ error: 'Missing Host header' });
      }

      const hostPattern = /^(127\.0\.0\.1|localhost)(:\d+)?$/i;
      if (!hostPattern.test(host)) {
        return reply.status(403).send({ error: 'Forbidden: Invalid Host header' });
      }
    });

    // 2. Strict Origin validation for all requests carrying an Origin header
    this.app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      const originHeader = request.headers.origin;
      if (!originHeader || originHeader === 'null') {
        // Non-browser local CLI / script request
        return;
      }

      const validated = this.parseAndValidateOrigin(originHeader);
      if (!validated) {
        return reply.status(403).send({ error: 'Forbidden: Cross-origin request denied' });
      }
    });

    // 3. Preflight OPTIONS handler with exact matching origin
    this.app.options('/*', async (request: FastifyRequest, reply: FastifyReply) => {
      const originHeader = request.headers.origin;
      if (!originHeader) {
        return reply.status(400).send({ error: 'Missing Origin in preflight' });
      }

      const validated = this.parseAndValidateOrigin(originHeader);
      if (!validated) {
        return reply.status(403).send({ error: 'Forbidden: Untrusted preflight origin' });
      }

      const requestedMethod = request.headers['access-control-request-method'];
      const allowedMethods = ['GET', 'POST', 'DELETE', 'OPTIONS'];
      if (requestedMethod && !allowedMethods.includes(requestedMethod.toUpperCase())) {
        return reply.status(403).send({ error: 'Forbidden: Disallowed method in preflight' });
      }

      // SEC-01: Reject preflights for mutating operations from non-extension browser origins
      if (['POST', 'DELETE', 'PUT', 'PATCH'].includes(requestedMethod?.toUpperCase() || '')) {
        if (!validated.isExtension) {
          return reply.status(403).send({
            error: 'Forbidden: Browser web origins are not authorized for mutating operations'
          });
        }
      }

      reply
        .header('Access-Control-Allow-Origin', validated.origin)
        .header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        .header(
          'Access-Control-Allow-Headers',
          `Content-Type, ${CONTROL_API_CSRF_HEADER}, ${CONTROL_API_AUTH_HEADER}, ${CONTROL_API_CLI_HEADER}`
        )
        .header('Access-Control-Max-Age', '86400')
        .status(204)
        .send();
    });

    // 4. Set exact CORS headers on allowed responses
    this.app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply) => {
      const originHeader = request.headers.origin;
      if (originHeader && originHeader !== 'null') {
        const validated = this.parseAndValidateOrigin(originHeader);
        if (validated) {
          reply.header('Access-Control-Allow-Origin', validated.origin);
          reply.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
          reply.header(
            'Access-Control-Allow-Headers',
            `Content-Type, ${CONTROL_API_CSRF_HEADER}, ${CONTROL_API_AUTH_HEADER}, ${CONTROL_API_CLI_HEADER}`
          );
        }
      }
    });

    // 5. Strict Authorization & CSRF Protection for mutating operations (POST, DELETE, PUT, PATCH)
    this.app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
      if (['POST', 'DELETE', 'PUT', 'PATCH'].includes(request.method)) {
        const originHeader = request.headers.origin;

        if (originHeader && originHeader !== 'null') {
          // Browser / Extension request
          const validated = this.parseAndValidateOrigin(originHeader);
          if (!validated || !validated.isExtension) {
            return reply.status(403).send({
              error: 'Forbidden: Browser web origins are not authorized for mutating operations'
            });
          }

          // Even for trusted extension, CSRF header is mandatory
          const csrfHeader = request.headers[CONTROL_API_CSRF_HEADER];
          if (!csrfHeader) {
            return reply.status(403).send({
              error: `Forbidden: Mutating operations require ${CONTROL_API_CSRF_HEADER} header`
            });
          }
        } else {
          // Non-browser local CLI / script request
          // Must explicitly provide CLI intent header or auth token
          const cliHeader = request.headers[CONTROL_API_CLI_HEADER];
          const authHeader = request.headers[CONTROL_API_AUTH_HEADER];

          if (!cliHeader && !authHeader) {
            return reply.status(403).send({
              error: `Forbidden: CLI mutating operations require ${CONTROL_API_CLI_HEADER} or ${CONTROL_API_AUTH_HEADER} header`
            });
          }
        }
      }

      // Optional authentication check
      if (this.requireAuth && this.controlToken) {
        if (request.url !== '/health') {
          const incomingToken = request.headers[CONTROL_API_AUTH_HEADER];
          if (incomingToken !== this.controlToken) {
            return reply.status(401).send({ error: 'Unauthorized: Invalid control token' });
          }
        }
      }
    });
  }

  /**
   * Registers REST endpoints.
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/health', async () => {
      return {
        status: 'ok',
        version: '0.1.0',
        uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000)
      };
    });

    // Get current sanitized session (token is masked)
    this.app.get('/api/v1/session', async (_request, reply) => {
      const sanitized = this.sessionManager.getSanitizedSession();
      if (!sanitized) {
        return reply.status(404).send({ error: 'No active session' });
      }

      return {
        session: sanitized,
        activeControlPort: this.port,
        activeProxyPort: this.proxyPort
      };
    });

    // Get unmasked pairing URL (strictly restricted to trusted extension or authenticated CLI)
    this.app.get('/api/v1/session/pairing-url', async (request: FastifyRequest, reply: FastifyReply) => {
      const originHeader = request.headers.origin;

      if (originHeader && originHeader !== 'null') {
        const validated = this.parseAndValidateOrigin(originHeader);
        // Strictly prohibit localhost web origins from accessing the pairing URL
        if (!validated || !validated.isExtension) {
          return reply.status(403).send({
            error: 'Forbidden: Localhost websites are not authorized to access pairing URLs'
          });
        }
      } else {
        // Non-browser CLI access: must provide custom intent header
        const cliHeader = request.headers[CONTROL_API_CLI_HEADER];
        const authHeader = request.headers[CONTROL_API_AUTH_HEADER];
        if (!cliHeader && !authHeader) {
          return reply.status(403).send({
            error: 'Forbidden: CLI access requires custom header authentication'
          });
        }
      }

      const session = this.sessionManager.getSession();
      if (!session) {
        return reply.status(404).send({ error: 'No active session' });
      }

      // Return ONLY pairingUrl; no separate raw token field
      return {
        pairingUrl: session.mobileUrl
      };
    });

    // Discover running development servers (restricted to trusted extension or authenticated CLI)
    this.app.get('/api/v1/discover', async (request: FastifyRequest, reply: FastifyReply) => {
      const originHeader = request.headers.origin;

      if (originHeader && originHeader !== 'null') {
        const validated = this.parseAndValidateOrigin(originHeader);
        if (!validated || !validated.isExtension) {
          return reply.status(403).send({
            error: 'Forbidden: Server discovery is restricted to trusted extensions'
          });
        }
      } else {
        const cliHeader = request.headers[CONTROL_API_CLI_HEADER];
        const authHeader = request.headers[CONTROL_API_AUTH_HEADER];
        if (!cliHeader && !authHeader) {
          return reply.status(403).send({
            error: 'Forbidden: CLI access requires custom header authentication'
          });
        }
      }

      if (this.onDiscover) {
        try {
          const servers = await this.onDiscover();
          return { servers, total: servers.length };
        } catch {
          return { servers: [], total: 0 };
        }
      }
      return { servers: [], total: 0 };
    });

    // Create or update session
    this.app.post<{
      Body: {
        target: {
          port: number;
          host?: string;
          framework?: string;
          frameworkName?: string;
          isHttps?: boolean;
          title?: string;
        };
      };
    }>('/api/v1/session', async (request, reply) => {
      const body = request.body;

      if (!body || !body.target || typeof body.target.port !== 'number') {
        return reply.status(400).send({ error: 'Invalid target configuration: port is required' });
      }

      const port = body.target.port;
      if (port < 1024 || port > 65535) {
        return reply.status(400).send({ error: 'Target port must be between 1024 and 65535' });
      }

      const host = body.target.host ?? '127.0.0.1';
      // Restrict target host strictly to loopback to prevent SSRF
      if (host !== '127.0.0.1' && host !== 'localhost') {
        return reply.status(400).send({ error: 'Target host must be 127.0.0.1 or localhost' });
      }

      const target: TargetDevServer = {
        host,
        port,
        framework: (body.target.framework as TargetDevServer['framework']) ?? 'unknown',
        frameworkName: body.target.frameworkName,
        isHttps: body.target.isHttps ?? false,
        title: body.target.title
      };

      if (this.onTargetChange) {
        await this.onTargetChange(target);
      } else if (this.sessionManager.hasActiveSession()) {
        this.sessionManager.updateTarget(target);
      } else {
        this.sessionManager.createSession({
          target,
          lanIp: this.lanIp,
          proxyPort: this.proxyPort,
          controlPort: this.port
        });
      }

      const session = this.sessionManager.getSanitizedSession()!;

      return {
        success: true,
        session
      };
    });

    // Revoke session
    this.app.delete('/api/v1/session', async () => {
      if (this.onSessionRevoke) {
        await this.onSessionRevoke();
      }
      this.sessionManager.revokeSession();
      return {
        success: true,
        revokedAt: Date.now()
      };
    });

    // List connected devices (restricted to trusted extension or authenticated CLI)
    this.app.get('/api/v1/devices', async (request: FastifyRequest, reply: FastifyReply) => {
      const originHeader = request.headers.origin;

      if (originHeader && originHeader !== 'null') {
        const validated = this.parseAndValidateOrigin(originHeader);
        if (!validated || !validated.isExtension) {
          return reply.status(403).send({
            error: 'Forbidden: Device inspection is restricted to trusted extensions'
          });
        }
      } else {
        const cliHeader = request.headers[CONTROL_API_CLI_HEADER];
        const authHeader = request.headers[CONTROL_API_AUTH_HEADER];
        if (!cliHeader && !authHeader) {
          return reply.status(403).send({
            error: 'Forbidden: CLI access requires custom header authentication'
          });
        }
      }

      const devices = this.sessionManager.getConnectedDevices();
      return {
        devices,
        total: devices.length
      };
    });
  }

  /**
   * Starts listening strictly on 127.0.0.1.
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    await this.app.listen({
      port: this.port,
      host: '127.0.0.1'
    });
    const addr = this.app.server.address();
    if (addr && typeof addr === 'object') {
      this.actualPort = addr.port;
    } else {
      this.actualPort = this.port;
    }
    this.isRunning = true;
  }

  /**
   * Closes the server and releases ports.
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    await this.app.close();
    this.isRunning = false;
  }

  public get assignedPort(): number {
    return this.actualPort || this.port;
  }

  public get fastify(): FastifyInstance {
    return this.app;
  }

  public get running(): boolean {
    return this.isRunning;
  }
}
