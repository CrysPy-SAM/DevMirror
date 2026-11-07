/**
 * @devmirror/core - Port Manager
 * Handles automatic port selection, availability testing, and fallback increments.
 */

import net from 'node:net';
import {
  DEFAULT_PROXY_PORT,
  DEFAULT_CONTROL_PORT,
  MAX_PORT_FALLBACK_ATTEMPTS
} from '@devmirror/shared';

export interface FindPortOptions {
  preferredPort: number;
  host?: string;
  maxAttempts?: number;
}

export class PortManager {
  private readonly allocatedPorts: Set<number> = new Set();

  /**
   * Tests whether a specific port is currently available for listening on the given host.
   */
  public async isPortAvailable(port: number, host: string = '127.0.0.1'): Promise<boolean> {
    if (this.allocatedPorts.has(port)) {
      return false;
    }

    return new Promise((resolve) => {
      const server = net.createServer();

      server.once('error', () => {
        resolve(false);
      });

      server.once('listening', () => {
        server.close(() => {
          resolve(true);
        });
      });

      server.listen(port, host);
    });
  }

  /**
   * Finds an available port starting from preferredPort up to preferredPort + maxAttempts.
   * Throws an error if no available port is found within the threshold.
   */
  public async findAvailablePort(options: FindPortOptions): Promise<number> {
    const {
      preferredPort,
      host = '127.0.0.1',
      maxAttempts = MAX_PORT_FALLBACK_ATTEMPTS
    } = options;

    for (let offset = 0; offset < maxAttempts; offset++) {
      const candidate = preferredPort + offset;

      if (await this.isPortAvailable(candidate, host)) {
        this.allocatedPorts.add(candidate);
        return candidate;
      }
    }

    throw new Error(
      `Could not find an available port starting from ${preferredPort} after ${maxAttempts} attempts on ${host}`
    );
  }

  /**
   * Finds available ports for both the LAN proxy and the local control API.
   */
  public async resolvePorts(options?: {
    preferredProxyPort?: number;
    preferredControlPort?: number;
  }): Promise<{ proxyPort: number; controlPort: number }> {
    const preferredProxy =
      options?.preferredProxyPort && options.preferredProxyPort > 0
        ? options.preferredProxyPort
        : DEFAULT_PROXY_PORT;
    const preferredControl =
      options?.preferredControlPort && options.preferredControlPort > 0
        ? options.preferredControlPort
        : DEFAULT_CONTROL_PORT;

    const proxyPort = await this.findAvailablePort({
      preferredPort: preferredProxy,
      host: '0.0.0.0'
    });

    const controlPort = await this.findAvailablePort({
      preferredPort: preferredControl,
      host: '127.0.0.1'
    });

    return { proxyPort, controlPort };
  }

  /**
   * Releases an allocated port back to the pool.
   */
  public releasePort(port: number): void {
    this.allocatedPorts.delete(port);
  }

  /**
   * Releases all allocated ports.
   */
  public releaseAll(): void {
    this.allocatedPorts.clear();
  }
}
