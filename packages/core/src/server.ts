/**
 * @devmirror/core - DevMirror Engine
 * High-level coordinator managing lifecycle, ports, network resolution, session, and servers.
 */

import {
  DEFAULT_PROXY_PORT,
  DEFAULT_CONTROL_PORT,
  type TargetDevServer,
  type SessionInfo,
  type SanitizedSessionInfo,
  type TunnelStatus,
  type TunnelInfo
} from '@devmirror/shared';
import { SessionManager } from './session/manager.js';
import { LanIpResolver } from './network/resolver.js';
import { PortManager } from './network/port-manager.js';
import { ControlApi } from './control/api.js';
import { LanProxyServer } from './proxy/server.js';
import { PasswordAuthManager } from './auth/password.js';
import { CloudflareTunnel } from './tunnel/cloudflare.js';

export interface DevMirrorEngineOptions {
  preferredProxyPort?: number;
  preferredControlPort?: number;
  target?: TargetDevServer;
  sessionTtlMs?: number;
  enableOverlay?: boolean; // Default must be false!
  enableGracefulShutdown?: boolean;
  allowedExtensionIds?: string[];
  onDiscover?: () => Promise<any[]>;
  enableTunnel?: boolean;
  tunnelPassword?: string;
  cloudflaredPath?: string;
  tunnelTimeoutMs?: number;
  onTunnelStatusChange?: (status: TunnelStatus, url?: string, error?: string) => void;
  tunnelSpawnFn?: any;
}

export class DevMirrorEngine {
  private readonly options: DevMirrorEngineOptions;
  private readonly lanResolver: LanIpResolver;
  private readonly portManager: PortManager;
  private readonly sessionManager: SessionManager;

  private controlApi: ControlApi | null = null;
  private proxyServer: LanProxyServer | null = null;
  private tunnel: CloudflareTunnel | null = null;
  private passwordAuth: PasswordAuthManager | null = null;
  private activeProxyPort: number = 0;
  private activeControlPort: number = 0;
  private activeLanIp: string = '';
  private isRunning: boolean = false;
  private shutdownHooksRegistered: boolean = false;

  constructor(options: DevMirrorEngineOptions = {}) {
    this.options = options;
    this.lanResolver = new LanIpResolver();
    this.portManager = new PortManager();
    this.sessionManager = new SessionManager(options.sessionTtlMs);

    if (options.enableTunnel) {
      this.passwordAuth = new PasswordAuthManager({
        customPassword: options.tunnelPassword
      });
    }

    if (options.enableGracefulShutdown) {
      this.registerSignalHandlers();
    }
  }

  /**
   * Initializes and starts both the Control API and LAN Reverse Proxy.
   */
  public async start(): Promise<{
    session: SessionInfo | null;
    sanitizedSession: SanitizedSessionInfo | null;
    proxyPort: number;
    controlPort: number;
    lanIp: string;
    tunnelInfo: TunnelInfo;
    publicPassword?: string;
  }> {
    if (this.isRunning) {
      throw new Error('DevMirror Engine is already running');
    }

    // 1. Resolve LAN IP
    const lanResult = this.lanResolver.resolve();
    this.activeLanIp = lanResult.ip;

    // 2. Resolve available ports with automatic fallback
    const { proxyPort, controlPort } = await this.portManager.resolvePorts({
      preferredProxyPort: this.options.preferredProxyPort ?? DEFAULT_PROXY_PORT,
      preferredControlPort: this.options.preferredControlPort ?? DEFAULT_CONTROL_PORT
    });

    this.activeProxyPort = proxyPort;
    this.activeControlPort = controlPort;

    // 3. Start Control API (strictly 127.0.0.1)
    this.controlApi = new ControlApi({
      port: controlPort,
      sessionManager: this.sessionManager,
      lanIp: this.activeLanIp,
      proxyPort,
      allowedExtensionIds: this.options.allowedExtensionIds,
      onDiscover: this.options.onDiscover,
      onTargetChange: async (target) => {
        await this.setTarget(target);
      },
      onSessionRevoke: async () => {
        if (this.proxyServer) {
          this.proxyServer.closeActiveSockets();
        }
      }
    });
    await this.controlApi.start();
    this.activeControlPort = this.controlApi.assignedPort;

    // 4. If target is provided, create session and start LAN Proxy
    let session: SessionInfo | null = null;
    if (this.options.target) {
      this.proxyServer = new LanProxyServer({
        port: proxyPort,
        host: '0.0.0.0',
        sessionManager: this.sessionManager,
        target: this.options.target,
        enableOverlay: this.options.enableOverlay ?? false,
        passwordAuth: this.passwordAuth ?? undefined,
        getTunnelUrl: () => this.tunnel?.publicUrl
      });
      await this.proxyServer.start();
      this.activeProxyPort = this.proxyServer.assignedPort;

      session = this.sessionManager.createSession({
        target: this.options.target,
        lanIp: this.activeLanIp,
        proxyPort: this.activeProxyPort,
        controlPort: this.activeControlPort
      });
    }

    // 5. Start Cloudflare Quick Tunnel if enabled
    let tunnelInfo: TunnelInfo = { status: 'idle' };
    if (this.options.enableTunnel) {
      this.tunnel = new CloudflareTunnel({
        proxyPort: this.activeProxyPort,
        cloudflaredPath: this.options.cloudflaredPath,
        timeoutMs: this.options.tunnelTimeoutMs,
        onStatusChange: this.options.onTunnelStatusChange,
        spawnFn: this.options.tunnelSpawnFn
      });

      try {
        await this.tunnel.start();
        tunnelInfo = this.tunnel.getInfo();
      } catch (err: any) {
        // Tunnel failed, but existing LAN access continues operating smoothly
        tunnelInfo = this.tunnel.getInfo();
      }
    }

    this.isRunning = true;

    return {
      session,
      sanitizedSession: this.sessionManager.getSanitizedSession(),
      proxyPort: this.activeProxyPort,
      controlPort: this.activeControlPort,
      lanIp: this.activeLanIp,
      tunnelInfo,
      publicPassword: this.passwordAuth?.getInitialPassword()
    };
  }

  /**
   * Updates or sets a target dev server and starts proxy if not already running.
   */
  public async setTarget(target: TargetDevServer): Promise<SessionInfo> {
    if (!this.isRunning) {
      throw new Error('Engine must be running to set target');
    }

    let session: SessionInfo;
    if (this.sessionManager.hasActiveSession()) {
      this.sessionManager.updateTarget(target);
      session = this.sessionManager.getSession()!;
    } else {
      session = this.sessionManager.createSession({
        target,
        lanIp: this.activeLanIp,
        proxyPort: this.activeProxyPort,
        controlPort: this.activeControlPort
      });
    }

    if (this.proxyServer) {
      this.proxyServer.updateTarget(target);
    } else {
      this.proxyServer = new LanProxyServer({
        port: this.activeProxyPort,
        host: '0.0.0.0',
        sessionManager: this.sessionManager,
        target,
        enableOverlay: this.options.enableOverlay ?? false,
        passwordAuth: this.passwordAuth ?? undefined,
        getTunnelUrl: () => this.tunnel?.publicUrl
      });
      await this.proxyServer.start();
    }

    return session;
  }

  /**
   * Gracefully shuts down all servers and releases ports.
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) return;

    if (this.tunnel) {
      await this.tunnel.stop();
      this.tunnel = null;
    }

    if (this.proxyServer) {
      await this.proxyServer.stop();
      this.proxyServer = null;
    }

    if (this.controlApi) {
      await this.controlApi.stop();
      this.controlApi = null;
    }

    this.portManager.releaseAll();
    this.sessionManager.revokeSession();
    this.isRunning = false;
  }

  /**
   * Registers SIGINT and SIGTERM handlers for process termination.
   */
  private registerSignalHandlers(): void {
    if (this.shutdownHooksRegistered) return;
    this.shutdownHooksRegistered = true;

    const cleanup = async () => {
      try {
        await this.stop();
      } catch {
        // silent exit
      }
      process.exit(0);
    };

    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  }

  // Getters for inspection and testing
  public get running(): boolean {
    return this.isRunning;
  }

  public get lanIp(): string {
    return this.activeLanIp;
  }

  public getTunnelInfo(): TunnelInfo {
    return this.tunnel?.getInfo() ?? { status: 'idle' };
  }

  public getPublicPassword(): string | undefined {
    return this.passwordAuth?.getInitialPassword();
  }

  public get proxyPort(): number {
    return this.activeProxyPort;
  }

  public get controlPort(): number {
    return this.activeControlPort;
  }

  public get session(): SessionManager {
    return this.sessionManager;
  }

  public get control(): ControlApi | null {
    return this.controlApi;
  }

  public get proxy(): LanProxyServer | null {
    return this.proxyServer;
  }
}
