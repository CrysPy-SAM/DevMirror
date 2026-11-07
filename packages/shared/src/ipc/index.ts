/**
 * DevMirror IPC and Control API Contracts
 * Definitions for REST endpoints and WebSocket events between CLI, Chrome Extension, and Control API.
 */

import type { SessionInfo, TargetDevServer, ConnectedClient, SupportedFramework } from '../types/index.js';

export interface HealthResponse {
  status: 'ok';
  version: string;
  uptimeSeconds: number;
}

export interface SessionResponse {
  session: SessionInfo;
  activeControlPort: number;
  activeProxyPort: number;
}

export interface TargetUpdateRequest {
  port: number;
  host?: string;
  framework?: SupportedFramework;
}

export interface TargetUpdateResponse {
  success: boolean;
  target: TargetDevServer;
  session: SessionInfo;
}

export interface RevokeSessionRequest {
  sessionId?: string;
  reason?: string;
}

export interface RevokeSessionResponse {
  success: boolean;
  revokedAt: number;
}

export interface ClientApprovalRequest {
  clientId: string;
  approved: boolean;
}

export interface ClientApprovalResponse {
  clientId: string;
  approved: boolean;
}

export type ControlEventMap = {
  TARGET_CHANGED: {
    previous: TargetDevServer;
    current: TargetDevServer;
  };
  CLIENT_CONNECTED: {
    client: ConnectedClient;
    totalClients: number;
  };
  CLIENT_DISCONNECTED: {
    clientId: string;
    totalClients: number;
  };
  CLIENT_APPROVAL_REQUIRED: {
    client: ConnectedClient;
  };
  SESSION_REVOKED: {
    sessionId: string;
    timestamp: number;
  };
  STATUS_UPDATE: {
    proxyPort: number;
    controlPort: number;
    connectedCount: number;
  };
};

export type ControlEventType = keyof ControlEventMap;

export interface ControlEventEnvelope<T extends ControlEventType = ControlEventType> {
  type: T;
  payload: ControlEventMap[T];
  timestamp: number;
}
