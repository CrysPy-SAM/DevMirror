/**
 * @devmirror/core - Vite HMR Adapter
 * Handles Vite HMR WebSocket routing, subprotocols ('vite-hmr'), and header normalization.
 */

import type { TargetDevServer } from '@devmirror/shared';
import type { IHmrAdapter } from './types.js';

export class ViteHmrAdapter implements IHmrAdapter {
  public readonly framework = 'vite' as const;

  public matches(urlPath: string): boolean {
    const cleanPath = urlPath.split('?')[0];
    return cleanPath === '/@vite-hmr' || cleanPath === '/' || cleanPath === '';
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

    // Rewrite Host to target
    normalized['host'] = `${target.host}:${target.port}`;

    // Normalize Origin to match target server protocol & host
    const scheme = target.isHttps ? 'https' : 'http';
    normalized['origin'] = `${scheme}://${target.host}:${target.port}`;

    return normalized;
  }
}
