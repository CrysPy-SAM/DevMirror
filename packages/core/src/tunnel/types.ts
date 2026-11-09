/**
 * @devmirror/core - Tunnel Types
 */

import type { ChildProcess, spawn } from 'node:child_process';
import type { TunnelStatus, TunnelInfo } from '@devmirror/shared';

export interface ITunnel {
  readonly status: TunnelStatus;
  readonly publicUrl?: string;
  start(): Promise<string>;
  stop(): Promise<void>;
  getInfo(): TunnelInfo;
}

export interface CloudflareTunnelOptions {
  proxyPort: number;
  cloudflaredPath?: string;
  timeoutMs?: number;
  onStatusChange?: (status: TunnelStatus, url?: string, error?: string) => void;
  spawnFn?: typeof spawn;
}
