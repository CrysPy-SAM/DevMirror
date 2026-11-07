/**
 * @devmirror/core - Nuxt HMR Adapter
 * Handles Nuxt 3 Vite/Webpack WebSocket and HMR connections (/@vite-hmr, /_nuxt/).
 */

import type { TargetDevServer } from '@devmirror/shared';
import type { IHmrAdapter } from './types.js';

export class NuxtHmrAdapter implements IHmrAdapter {
  public readonly framework = 'nuxt' as const;

  public matches(urlPath: string): boolean {
    const cleanPath = urlPath.split('?')[0];
    return (
      cleanPath === '/@vite-hmr' ||
      cleanPath === '/' ||
      cleanPath === '' ||
      cleanPath.startsWith('/_nuxt') ||
      cleanPath.startsWith('/__nuxt')
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

    normalized['host'] = `${target.host}:${target.port}`;
    const scheme = target.isHttps ? 'https' : 'http';
    normalized['origin'] = `${scheme}://${target.host}:${target.port}`;

    return normalized;
  }
}
