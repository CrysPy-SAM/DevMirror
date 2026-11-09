/**
 * @devmirror/core - Cloudflare Quick Tunnel Manager
 * Spawns and manages zero-config ephemeral Cloudflare Quick Tunnels (trycloudflare.com).
 * Forwards traffic strictly to DevMirror's authenticated LAN/loopback reverse proxy.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn as defaultSpawn, type ChildProcess } from 'node:child_process';
import type { TunnelStatus, TunnelInfo } from '@devmirror/shared';
import type { ITunnel, CloudflareTunnelOptions } from './types.js';

/**
 * Resolves cloudflared executable path across Windows, macOS, and Linux.
 * Checks custom path, env var, system PATH, and known installation directories.
 */
export function resolveCloudflaredPath(customPath?: string): string {
  if (customPath && customPath !== 'cloudflared') {
    return customPath;
  }
  if (process.env.CLOUDFLARED_PATH) {
    return process.env.CLOUDFLARED_PATH;
  }

  // Windows standard paths
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');

    // 1. WinGet Packages directory
    const wingetPackagesDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
    if (fs.existsSync(wingetPackagesDir)) {
      try {
        const entries = fs.readdirSync(wingetPackagesDir);
        for (const entry of entries) {
          if (entry.toLowerCase().startsWith('cloudflare.cloudflared')) {
            const candidate = path.join(wingetPackagesDir, entry, 'cloudflared.exe');
            if (fs.existsSync(candidate)) {
              return candidate;
            }
          }
        }
      } catch {}
    }

    // 2. WinGet Links & standard locations
    const candidatePaths = [
      path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
      path.join(programFiles, 'cloudflared', 'cloudflared.exe'),
      path.join(programFilesX86, 'cloudflared', 'cloudflared.exe'),
      path.join(appData, 'npm', 'cloudflared.exe'),
      path.join(os.homedir(), '.cloudflared', 'cloudflared.exe')
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
  } else {
    // POSIX locations
    const posixCandidates = [
      '/usr/local/bin/cloudflared',
      '/opt/homebrew/bin/cloudflared',
      '/usr/bin/cloudflared',
      path.join(os.homedir(), '.cloudflared', 'cloudflared'),
      path.join(os.homedir(), '.local', 'bin', 'cloudflared')
    ];

    for (const p of posixCandidates) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
  }

  return 'cloudflared';
}

export class CloudflareTunnel implements ITunnel {
  private readonly proxyPort: number;
  private readonly cloudflaredPath: string;
  private readonly timeoutMs: number;
  private readonly onStatusChange?: (status: TunnelStatus, url?: string, error?: string) => void;
  private readonly spawnFn: typeof defaultSpawn;

  private childProcess: ChildProcess | null = null;
  private _status: TunnelStatus = 'idle';
  private _publicUrl?: string;
  private _error?: string;
  private isStopping: boolean = false;

  constructor(options: CloudflareTunnelOptions) {
    this.proxyPort = options.proxyPort;
    this.cloudflaredPath = resolveCloudflaredPath(options.cloudflaredPath);
    this.timeoutMs = options.timeoutMs ?? 20000;
    this.onStatusChange = options.onStatusChange;
    this.spawnFn = options.spawnFn ?? defaultSpawn;
  }

  public get status(): TunnelStatus {
    return this._status;
  }

  public get publicUrl(): string | undefined {
    return this._publicUrl;
  }

  public getInfo(): TunnelInfo {
    return {
      status: this._status,
      url: this._publicUrl,
      error: this._error
    };
  }

  private setStatus(status: TunnelStatus, url?: string, error?: string): void {
    this._status = status;
    if (url !== undefined) this._publicUrl = url;
    if (error !== undefined) this._error = error;
    this.onStatusChange?.(status, this._publicUrl, this._error);
  }

  /**
   * Starts cloudflared Quick Tunnel child process and extracts the trycloudflare.com URL.
   */
  public async start(): Promise<string> {
    if (this._status === 'connected' && this._publicUrl) {
      return this._publicUrl;
    }
    if (this._status === 'starting') {
      throw new Error('Cloudflare Tunnel is already starting');
    }

    this.setStatus('starting');
    this.isStopping = false;

    // Direct tunnel traffic strictly to DevMirror's proxy port on loopback
    const args = ['tunnel', '--url', `http://127.0.0.1:${this.proxyPort}`, '--no-autoupdate'];

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let outputBuffer = '';

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          const errMsg = `Cloudflare Tunnel startup timed out after ${this.timeoutMs}ms.`;
          this.setStatus('failed', undefined, errMsg);
          this.stop().catch(() => {});
          reject(new Error(errMsg));
        }
      }, this.timeoutMs);

      try {
        this.childProcess = this.spawnFn(this.cloudflaredPath, args, {
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, NO_COLOR: '1' }
        });
      } catch (err: any) {
        clearTimeout(timer);
        settled = true;
        const msg = err.code === 'ENOENT'
          ? `cloudflared binary not found at "${this.cloudflaredPath}". Install cloudflared to enable public tunnel preview.`
          : `Failed to spawn cloudflared: ${err.message}`;
        this.setStatus('failed', undefined, msg);
        return reject(new Error(msg));
      }

      this.childProcess.on('error', (err: any) => {
        if (!settled) {
          clearTimeout(timer);
          settled = true;
          const msg = err.code === 'ENOENT'
            ? `cloudflared binary not found at "${this.cloudflaredPath}". Install cloudflared to enable public tunnel preview.`
            : `cloudflared process error: ${err.message}`;
          this.setStatus('failed', undefined, msg);
          reject(new Error(msg));
        } else if (!this.isStopping) {
          this.setStatus('failed', undefined, err.message);
        }
      });

      const handleData = (chunk: Buffer | string) => {
        const text = chunk.toString();
        outputBuffer += text;

        // Search for Quick Tunnel URL
        const match = outputBuffer.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/i);
        if (match && !settled) {
          clearTimeout(timer);
          settled = true;
          const url = match[0];
          this.setStatus('connected', url);
          resolve(url);
        }
      };

      this.childProcess.stdout?.on('data', handleData);
      this.childProcess.stderr?.on('data', handleData);

      this.childProcess.on('exit', (code, signal) => {
        this.childProcess = null;
        if (!settled) {
          clearTimeout(timer);
          settled = true;
          const msg = `cloudflared exited unexpectedly with code ${code} (${signal ?? 'none'}) before creating tunnel. Output:\n${outputBuffer.slice(0, 300)}`;
          this.setStatus('failed', undefined, msg);
          reject(new Error(msg));
        } else if (!this.isStopping) {
          this.setStatus('stopped', undefined, `Tunnel process exited (code: ${code})`);
        }
      });
    });
  }

  /**
   * Gracefully terminates the cloudflared process.
   */
  public async stop(): Promise<void> {
    if (this._status === 'stopped' || this._status === 'idle') {
      return;
    }

    this.isStopping = true;
    const proc = this.childProcess;
    this.childProcess = null;

    if (proc && proc.pid) {
      try {
        if (process.platform === 'win32') {
          // On Windows, cleanly kill process tree using taskkill
          defaultSpawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { shell: true });
        } else {
          proc.kill('SIGTERM');
          // Fallback force kill after 1500ms
          setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch {}
          }, 1500);
        }
      } catch {}
    }

    if (this._status !== 'failed') {
      this.setStatus('stopped');
    }
  }
}
