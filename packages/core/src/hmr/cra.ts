/**
 * @devmirror/core - Create React App (Webpack Dev Server) HMR Adapter
 * Handles Webpack Dev Server WebSocket connections on `/ws` (v4/v5) and `/sockjs-node` (v3).
 */

import type { TargetDevServer } from '@devmirror/shared';
import type { IHmrAdapter } from './types.js';
import { formatTargetHost } from '../network/host.js';

export class CraHmrAdapter implements IHmrAdapter {
  public readonly framework = 'cra' as const;

  public matches(urlPath: string): boolean {
    const cleanPath = urlPath.split('?')[0];
    return (
      cleanPath === '/ws' ||
      cleanPath.startsWith('/ws/') ||
      cleanPath === '/sockjs-node' ||
      cleanPath.startsWith('/sockjs-node/')
    );
  }

  public normalizeHeaders(
    headers: Record<string, string | string[] | undefined>,
    target: TargetDevServer
  ): Record<string, string> {
    const normalized: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) {
        normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
      }
    }

    const targetHostFormatted = formatTargetHost(target.host, target.port);
    normalized['host'] = targetHostFormatted;
    const scheme = target.isHttps ? 'https' : 'http';
    normalized['origin'] = `${scheme}://${targetHostFormatted}`;

    return normalized;
  }
}
