/**
 * @devmirror/core - Session Manager
 * Cryptographically secure session lifecycle, token minting, device tracking, and revocation.
 */

import crypto from 'node:crypto';
import {
  SESSION_TTL_MS,
  SESSION_QUERY_PARAM,
  maskToken,
  type SessionInfo,
  type SanitizedSessionInfo,
  type TargetDevServer,
  type ConnectedClient,
  type DevicePairingMode,
  type DeviceType
} from '@devmirror/shared';

export interface CreateSessionOptions {
  target: TargetDevServer;
  lanIp: string;
  proxyPort: number;
  controlPort: number;
  pairingMode?: DevicePairingMode;
  ttlMs?: number;
}

export interface RegisterDeviceOptions {
  ip: string;
  userAgent: string;
}

export class SessionManager {
  private activeSession: SessionInfo | null = null;
  private readonly defaultTtlMs: number;

  constructor(defaultTtlMs: number = SESSION_TTL_MS) {
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * Generates a cryptographically secure 256-bit random token.
   * Uses base64url encoding (URL and HTTP header safe, 43 chars).
   */
  public generateSecureToken(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * Detects device type heuristically from User-Agent string.
   */
  public static detectDeviceType(userAgent: string): DeviceType {
    const ua = userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) return 'ios';
    if (/android/.test(ua)) return 'android';
    if (/windows|macintosh|linux/.test(ua)) return 'desktop';
    return 'unknown';
  }

  /**
   * Creates a new session with an ephemeral 256-bit token.
   */
  public createSession(options: CreateSessionOptions): SessionInfo {
    const now = Date.now();
    const token = this.generateSecureToken();
    const sessionId = crypto.randomUUID();
    const expiresAt = now + (options.ttlMs ?? this.defaultTtlMs);
    const pairingMode: DevicePairingMode = options.pairingMode ?? 'auto-trust';

    const mobileUrl = `http://${options.lanIp}:${options.proxyPort}/?${SESSION_QUERY_PARAM}=${token}`;

    this.activeSession = {
      sessionId,
      token,
      createdAt: now,
      expiresAt,
      target: { ...options.target },
      lanIp: options.lanIp,
      proxyPort: options.proxyPort,
      controlPort: options.controlPort,
      mobileUrl,
      pairingMode,
      connectedClients: []
    };

    return { ...this.activeSession };
  }

  /**
   * Returns whether a valid, non-expired session currently exists.
   */
  public hasActiveSession(): boolean {
    if (!this.activeSession) return false;
    if (Date.now() > this.activeSession.expiresAt) {
      this.revokeSession();
      return false;
    }
    return true;
  }

  /**
   * Validates an incoming token using constant-time comparison to prevent timing attacks.
   */
  public validateToken(incomingToken: string | null | undefined): boolean {
    if (!incomingToken || typeof incomingToken !== 'string') return false;
    if (!this.hasActiveSession()) return false;

    const currentToken = this.activeSession!.token;
    return this.timingSafeCompare(incomingToken, currentToken);
  }

  /**
   * Validates an incoming session cookie.
   */
  public validateCookie(incomingCookie: string | null | undefined): boolean {
    return this.validateToken(incomingCookie);
  }

  /**
   * Registers a new connected device or updates an existing device by IP and User-Agent.
   */
  public registerDevice(options: RegisterDeviceOptions): ConnectedClient {
    if (!this.hasActiveSession()) {
      throw new Error('Cannot register device without an active session');
    }

    const now = Date.now();
    const deviceType = SessionManager.detectDeviceType(options.userAgent);

    // Check if device already exists (same IP and UserAgent)
    const existing = this.activeSession!.connectedClients.find(
      (c) => c.ip === options.ip && c.userAgent === options.userAgent
    );

    if (existing) {
      existing.lastPingAt = now;
      return { ...existing };
    }

    const newClient: ConnectedClient = {
      id: crypto.randomUUID(),
      ip: options.ip,
      userAgent: options.userAgent,
      deviceType,
      connectedAt: now,
      lastPingAt: now,
      approved: this.activeSession!.pairingMode === 'auto-trust'
    };

    this.activeSession!.connectedClients.push(newClient);
    return { ...newClient };
  }

  /**
   * Updates heartbeat ping timestamp for a client.
   */
  public updateDevicePing(clientId: string): boolean {
    if (!this.activeSession) return false;
    const client = this.activeSession.connectedClients.find((c) => c.id === clientId);
    if (!client) return false;
    client.lastPingAt = Date.now();
    return true;
  }

  /**
   * Removes a connected device.
   */
  public removeDevice(clientId: string): boolean {
    if (!this.activeSession) return false;
    const initialLength = this.activeSession.connectedClients.length;
    this.activeSession.connectedClients = this.activeSession.connectedClients.filter(
      (c) => c.id !== clientId
    );
    return this.activeSession.connectedClients.length < initialLength;
  }

  /**
   * Returns list of connected devices.
   */
  public getConnectedDevices(): ConnectedClient[] {
    if (!this.hasActiveSession()) return [];
    return this.activeSession!.connectedClients.map((c) => ({ ...c }));
  }

  /**
   * Returns internal active session info (including token for QR generation).
   */
  public getSession(): SessionInfo | null {
    if (!this.hasActiveSession()) return null;
    return { ...this.activeSession! };
  }

  /**
   * Returns sanitized session info for public APIs and logs with token masked.
   */
  public getSanitizedSession(): SanitizedSessionInfo | null {
    if (!this.hasActiveSession()) return null;

    const session = this.activeSession!;
    const sanitizedUrl = `http://${session.lanIp}:${session.proxyPort}/?${SESSION_QUERY_PARAM}=${maskToken(session.token)}`;

    return {
      sessionId: session.sessionId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      target: { ...session.target },
      lanIp: session.lanIp,
      proxyPort: session.proxyPort,
      controlPort: session.controlPort,
      mobileUrl: sanitizedUrl,
      pairingMode: session.pairingMode,
      connectedClients: session.connectedClients.map((c) => ({ ...c }))
    };
  }

  /**
   * Updates current target server for the session.
   */
  public updateTarget(newTarget: TargetDevServer): void {
    if (!this.hasActiveSession()) {
      throw new Error('No active session to update target');
    }
    this.activeSession!.target = { ...newTarget };
  }

  /**
   * Revokes the active session and clears all client connections.
   */
  public revokeSession(): void {
    this.activeSession = null;
  }

  /**
   * Timing-safe string comparison preventing side-channel attacks.
   */
  private timingSafeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf-8');
    const bufB = Buffer.from(b, 'utf-8');

    if (bufA.length !== bufB.length) {
      return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
  }
}
