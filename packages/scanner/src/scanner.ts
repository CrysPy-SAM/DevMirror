/**
 * @devmirror/scanner - Dev Server Scanner Public API
 * Discovers and validates local development servers across common ports with framework fingerprinting.
 */

import {
  COMMON_DEV_PORTS,
  type DiscoveredDevServer,
  type DetectionConfidence
} from '@devmirror/shared';
import type { ScanOptions, ValidateOptions } from './types.js';
import { PortProber } from './prober/port-prober.js';
import { FrameworkDetector } from './fingerprint/detector.js';
import { ProcessInspector } from './process/inspector.js';

export class DevServerScanner {
  private readonly portProber: PortProber;
  private readonly processInspector: ProcessInspector;

  constructor(customProber?: PortProber, customProcessInspector?: ProcessInspector) {
    this.portProber = customProber || new PortProber();
    this.processInspector = customProcessInspector || new ProcessInspector();
  }

  /**
   * Generates a sequential list of port numbers from a start and end range.
   */
  private generatePortRange(start: number, end: number): number[] {
    const min = Math.max(1, Math.min(start, end));
    const max = Math.min(65535, Math.max(start, end));
    const ports: number[] = [];
    for (let p = min; p <= max; p++) {
      ports.push(p);
    }
    return ports;
  }

  /**
   * Scans for active development servers on the host.
   */
  public async scan(options: ScanOptions = {}): Promise<DiscoveredDevServer[]> {
    const host = options.host ?? '127.0.0.1';
    const timeoutMs = options.timeoutMs ?? 350;
    const concurrency = options.concurrency ?? 10;
    const includeProcessInfo = options.includeProcessInfo ?? true;
    const allowInsecureCertificates = options.allowInsecureCertificates ?? false;

    // 1. Resolve ports to scan
    let targetPorts: number[];
    if (options.ports && options.ports.length > 0) {
      targetPorts = options.ports;
    } else if (options.portRange) {
      targetPorts = this.generatePortRange(options.portRange.start, options.portRange.end);
    } else {
      targetPorts = [...COMMON_DEV_PORTS];
    }

    // Deduplicate and filter valid port range
    const validPorts = Array.from(new Set(targetPorts)).filter((p) => p >= 1 && p <= 65535 && Number.isInteger(p));

    // 2. Probe ports
    const probeResults = await this.portProber.scanPorts(
      host,
      validPorts,
      timeoutMs,
      concurrency,
      allowInsecureCertificates
    );

    // 3. Process open HTTP ports and build server descriptors
    const discoveredServers: DiscoveredDevServer[] = [];

    for (const res of probeResults) {
      // Must be open and accepting valid HTTP(S) connections
      if (!res.isOpen || !res.isHttp) continue;

      const effectiveHost = res.host ?? host;
      const urlHost =
        effectiveHost.includes(':') && !effectiveHost.startsWith('[')
          ? `[${effectiveHost}]`
          : effectiveHost;

      const detection = FrameworkDetector.detect(res.headers, res.bodySnippet);
      const isHttps = !!res.isHttps;
      const url = `http${isHttps ? 's' : ''}://${urlHost}:${res.port}`;

      let processId: number | undefined;
      let processName: string | undefined;

      if (includeProcessInfo) {
        try {
          const procInfo = await this.processInspector.findProcessByPort(res.port);
          if (procInfo) {
            processId = procInfo.pid;
            processName = procInfo.processName;
          }
        } catch {
          // Process discovery is strictly optional; proceed without it
        }
      }

      discoveredServers.push({
        host: effectiveHost,
        port: res.port,
        url,
        framework: detection.framework,
        frameworkName: detection.frameworkName,
        processId,
        processName,
        status: 'online',
        confidence: detection.confidence,
        title: detection.title,
        isHttps
      });
    }

    // Sort by confidence ('high' > 'medium' > 'low'), then by port ascending
    const confidenceOrder: Record<DetectionConfidence, number> = {
      high: 3,
      medium: 2,
      low: 1
    };
    discoveredServers.sort((a, b) => {
      const confDiff = confidenceOrder[b.confidence] - confidenceOrder[a.confidence];
      if (confDiff !== 0) return confDiff;
      return a.port - b.port;
    });

    return discoveredServers;
  }

  /**
   * Validates a manually specified host and port.
   * Returns a DiscoveredDevServer if an active server responds, or null if unreachable.
   */
  public async validate(
    host: string,
    port: number,
    options: ValidateOptions = {}
  ): Promise<DiscoveredDevServer | null> {
    const timeoutMs = options.timeoutMs ?? 1500;
    const includeProcessInfo = options.includeProcessInfo ?? true;
    const allowInsecureCertificates = options.allowInsecureCertificates ?? false;

    // Validate port boundaries
    if (port < 1 || port > 65535 || !Number.isInteger(port)) {
      throw new Error(`Invalid port: ${port}. Port must be an integer between 1 and 65535.`);
    }

    // Validate allowed host
    if (!PortProber.isAllowedHost(host)) {
      throw new Error(`Forbidden host: ${host}. Scanner only allows loopback and private LAN addresses.`);
    }

    const probe = await this.portProber.probePort(host, port, timeoutMs, allowInsecureCertificates);
    if (!probe.isOpen || !probe.isHttp) {
      return null;
    }

    const effectiveHost = probe.host ?? host;
    const urlHost =
      effectiveHost.includes(':') && !effectiveHost.startsWith('[')
        ? `[${effectiveHost}]`
        : effectiveHost;

    const detection = FrameworkDetector.detect(probe.headers, probe.bodySnippet);
    const isHttps = !!probe.isHttps;
    const url = `http${isHttps ? 's' : ''}://${urlHost}:${port}`;

    let processId: number | undefined;
    let processName: string | undefined;

    if (includeProcessInfo) {
      try {
        const procInfo = await this.processInspector.findProcessByPort(port);
        if (procInfo) {
          processId = procInfo.pid;
          processName = procInfo.processName;
        }
      } catch {
        // Optional
      }
    }

    return {
      host: effectiveHost,
      port,
      url,
      framework: detection.framework,
      frameworkName: detection.frameworkName,
      processId,
      processName,
      status: 'online',
      confidence: detection.confidence,
      title: detection.title,
      isHttps
    };
  }
}

// Global standalone convenience functions
const defaultScanner = new DevServerScanner();

export async function scanDevServers(options?: ScanOptions): Promise<DiscoveredDevServer[]> {
  return defaultScanner.scan(options);
}

export async function validateServer(
  host: string,
  port: number,
  options?: ValidateOptions
): Promise<DiscoveredDevServer | null> {
  return defaultScanner.validate(host, port, options);
}
