/**
 * @devmirror/core - Control API
 * Fastify HTTP server strictly bound to 127.0.0.1 for local management and Chrome Extension IPC.
 */

import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import {
  CONTROL_API_AUTH_HEADER,
  CONTROL_API_CSRF_HEADER,
  type TargetDevServer,
  type SanitizedSessionInfo
} from '@devmirror/shared';
import type { SessionManager } from '../session/manager.js';

export interface ControlApiOptions {
  port: number;
  sessionManager: SessionManager;
  lanIp: string;
  proxyPort: number;
  controlToken?: string;
  requireAuth?: boolean;
}

export class ControlApi {
  private readonly app: FastifyInstance;
  private readonly port: number;
  private readonly sessionManager: SessionManager;
  private readonly lanIp: string;
  private readonly proxyPort: number;
  private readonly controlToken?: string;
  private readonly requireAuth: boolean;
  private readonly startTime: number;
  private isRunning: boolean = false;

  constructor(options: ControlApiOptions) {
    this.port = options.port;
    this.sessionManager = options.sessionManager;
    this.lanIp = options.lanIp;
    this.proxyPort = options.proxyPort;
    this.controlToken = options.controlToken;
    this.requireAuth = options.requireAuth ?? false; // optional auth check for local CLI/Extension
    this.startTime = Date.now();

    this.app = Fastify({
      logger: false
    });

    this.setupSecurityHooks();
    this.setupRoutes();
  }

  /**
   * Applies strict Host, Origin, and CSRF validations.
   */
  private setupSecurityHooks(): void {
    // 1. Strict Host header validation
    this.app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      const host = request.headers.host;
      if (!host) {
        return reply.status(400).send({ error: 'Missing Host header' });
      }

      // Allow only 127.0.0.1 or localhost with optional port
      const hostPattern = /^(127\.0\.0\.1|localhost)(:\d+)?$/i;
      if (!hostPattern.test(host)) {
        return reply.status(403).send({ error: 'Forbidden: Invalid Host header' });
      }
    });

    // 2. Strict Origin validation (protects against browser drive-by attacks from untrusted websites)
    this.app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      const origin = request.headers.origin;
      if (!origin || origin === 'null') {
        // Non-browser or same-origin / extension local request
        return;
      }

      // Allow loopback origins and Chrome/Edge extensions
      const allowedOriginPattern = /^(https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?|chrome-extension:\/\/[a-z]+)$/i;
      if (!allowedOriginPattern.test(origin)) {
        return reply.status(403).send({ error: 'Forbidden: Cross-origin request denied' });
      }
    });

    // 3. CSRF & Custom Header Protection for mutating operations (POST, DELETE)
    this.app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
      if (['POST', 'DELETE', 'PUT', 'PATCH'].includes(request.method)) {
        const csrfHeader = request.headers[CONTROL_API_CSRF_HEADER];
        const authHeader = request.headers[CONTROL_API_AUTH_HEADER];

        // Ensure mutating requests originate from trusted local clients capable of sending custom headers
        if (!csrfHeader && !authHeader) {
          return reply.status(403).send({
            error: `Forbidden: Mutating operations require ${CONTROL_API_CSRF_HEADER} or ${CONTROL_API_AUTH_HEADER} header`
          });
        }
      }

      // 4. Optional authentication check
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

    // Get current sanitized session
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

    // Create or update session
    this.app.post<{
      Body: {
        target: {
          port: number;
          host?: string;
          framework?: string;
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
        isHttps: body.target.isHttps ?? false,
        title: body.target.title
      };

      let session: SanitizedSessionInfo;
      if (this.sessionManager.hasActiveSession()) {
        this.sessionManager.updateTarget(target);
        session = this.sessionManager.getSanitizedSession()!;
      } else {
        this.sessionManager.createSession({
          target,
          lanIp: this.lanIp,
          proxyPort: this.proxyPort,
          controlPort: this.port
        });
        session = this.sessionManager.getSanitizedSession()!;
      }

      return {
        success: true,
        session
      };
    });

    // Revoke session
    this.app.delete('/api/v1/session', async () => {
      this.sessionManager.revokeSession();
      return {
        success: true,
        revokedAt: Date.now()
      };
    });

    // List connected devices
    this.app.get('/api/v1/devices', async () => {
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

  /**
   * Internal Fastify instance for testing with inject().
   */
  public get fastify(): FastifyInstance {
    return this.app;
  }

  public get running(): boolean {
    return this.isRunning;
  }
}
