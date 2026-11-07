/**
 * DevMirror Shared Types
 * Core domain models, session definitions, and configuration schemas.
 */

export type SupportedFramework = 'vite' | 'nextjs' | 'angular' | 'vanilla' | 'unknown';

export type DeviceType = 'ios' | 'android' | 'desktop' | 'unknown';

export type DevicePairingMode = 'auto-trust' | 'pairing-guard';

export interface TargetDevServer {
  host: string;
  port: number;
  framework: SupportedFramework;
  pid?: number;
  cwd?: string;
  command?: string;
  isHttps: boolean;
  title?: string;
}

export interface ConnectedClient {
  id: string;
  ip: string;
  userAgent: string;
  deviceType: DeviceType;
  connectedAt: number;
  lastPingAt: number;
  approved: boolean;
}

export interface SessionInfo {
  sessionId: string;
  token: string;
  createdAt: number;
  expiresAt: number;
  target: TargetDevServer;
  lanIp: string;
  proxyPort: number;
  controlPort: number;
  mobileUrl: string;
  pairingMode: DevicePairingMode;
  connectedClients: ConnectedClient[];
}

export interface SanitizedSessionInfo {
  sessionId: string;
  createdAt: number;
  expiresAt: number;
  target: TargetDevServer;
  lanIp: string;
  proxyPort: number;
  controlPort: number;
  mobileUrl: string; // Token redacted or masked when serialized for logs
  pairingMode: DevicePairingMode;
  connectedClients: ConnectedClient[];
}

export interface DevMirrorConfig {
  preferredProxyPort: number;
  preferredControlPort: number;
  targetPort?: number;
  targetHost?: string;
  frameworkOverride?: SupportedFramework;
  enableOverlay: boolean;
  pairingMode: DevicePairingMode;
  sessionTtlMs: number;
  allowedOrigins: string[];
  maxPayloadBytes: number;
  rateLimitPerMin: number;
}
