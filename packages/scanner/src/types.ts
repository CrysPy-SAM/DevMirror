/**
 * @devmirror/scanner - Types & Configurations
 */

import type { DiscoveredDevServer, DetectedFramework, DetectionConfidence } from '@devmirror/shared';

export type { DiscoveredDevServer, DetectedFramework, DetectionConfidence };

export interface PortRange {
  start: number;
  end: number;
}

export interface ScanOptions {
  /**
   * Host interface to scan. Defaults to '127.0.0.1'.
   */
  host?: string;

  /**
   * Explicit list of ports to scan.
   * If omitted, defaults to COMMON_DEV_PORTS.
   */
  ports?: number[];

  /**
   * Optional sequential port range to scan.
   */
  portRange?: PortRange;

  /**
   * Timeout in milliseconds for probing each port.
   * Defaults to 350ms for high-speed scanning.
   */
  timeoutMs?: number;

  /**
   * Maximum concurrent port probes.
   * Defaults to 10.
   */
  concurrency?: number;

  /**
   * Whether to look up process IDs and names.
   * Defaults to true.
   */
  includeProcessInfo?: boolean;
}

export interface ValidateOptions {
  /**
   * Timeout in milliseconds for manual server validation.
   * Defaults to 1500ms.
   */
  timeoutMs?: number;

  /**
   * Whether to look up process info.
   * Defaults to true.
   */
  includeProcessInfo?: boolean;
}

export interface ProbeResult {
  port: number;
  isOpen: boolean;
  isHttp: boolean;
  statusCode?: number;
  headers?: Record<string, string>;
  bodySnippet?: string;
  isHttps?: boolean;
}
