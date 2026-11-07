/**
 * @devmirror/extension - Typed Control API Client
 * Manages communication with local DevMirror agent with CSRF protection and error isolation.
 */

import { CONTROL_API_CSRF_HEADER } from '@devmirror/shared';
import type {
  AgentHealth,
  SessionResponse,
  PairingUrlResponse,
  DiscoverResponse,
  DevicesResponse,
  TargetDevServer,
  ControlApiConfig
} from '../types.js';

export const DEFAULT_CONFIG: ControlApiConfig = {
  host: '127.0.0.1',
  port: 4100
};

export class ControlApiClient {
  private config: ControlApiConfig;

  constructor(config: Partial<ControlApiConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  public updateConfig(newConfig: Partial<ControlApiConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public get baseUrl(): string {
    return `http://${this.config.host}:${this.config.port}`;
  }

  /**
   * Checks agent connectivity and health.
   */
  public async checkHealth(): Promise<AgentHealth | null> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      if (!res.ok) return null;
      return (await res.json()) as AgentHealth;
    } catch {
      return null;
    }
  }

  /**
   * Retrieves the active sanitized session, or null if inactive.
   */
  public async getSession(): Promise<SessionResponse | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/session`);
      if (res.status === 404) return null;
      if (!res.ok) return null;
      return (await res.json()) as SessionResponse;
    } catch {
      return null;
    }
  }

  /**
   * Retrieves the unmasked mobile pairing URL for QR rendering.
   * Only accessible to the trusted Chrome Extension origin.
   */
  public async getPairingUrl(): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/session/pairing-url`);
      if (!res.ok) return null;
      const data = (await res.json()) as PairingUrlResponse;
      return data.pairingUrl || null;
    } catch {
      return null;
    }
  }

  /**
   * Discovers locally running development servers.
   */
  public async discoverServers(): Promise<DiscoverResponse> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/discover`);
      if (!res.ok) return { servers: [], total: 0 };
      return (await res.json()) as DiscoverResponse;
    } catch {
      return { servers: [], total: 0 };
    }
  }

  /**
   * Starts or updates a preview session with the selected target server.
   */
  public async startSession(target: Partial<TargetDevServer> & { port: number }): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [CONTROL_API_CSRF_HEADER]: '1'
        },
        body: JSON.stringify({ target })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Stops the active preview session.
   */
  public async stopSession(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/session`, {
        method: 'DELETE',
        headers: {
          [CONTROL_API_CSRF_HEADER]: '1'
        }
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Retrieves connected mobile devices.
   */
  public async getDevices(): Promise<DevicesResponse> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/devices`);
      if (!res.ok) return { devices: [], total: 0 };
      return (await res.json()) as DevicesResponse;
    } catch {
      return { devices: [], total: 0 };
    }
  }
}
