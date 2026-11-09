/**
 * @devmirror/core - Next.js HMR Adapter
 * Handles Next.js Fast Refresh & Turbopack WebSocket connections on `/_next/webpack-hmr`.
 */

import type { TargetDevServer } from '@devmirror/shared';
import type { IHmrAdapter } from './types.js';
import { formatTargetHost } from '../network/host.js';

export class NextjsHmrAdapter implements IHmrAdapter {
  public readonly framework = 'nextjs' as const;

  public matches(urlPath: string): boolean {
    const cleanPath = urlPath.split('?')[0];
    return cleanPath.startsWith('/_next/webpack-hmr') || cleanPath.startsWith('/_next/hmr');
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
