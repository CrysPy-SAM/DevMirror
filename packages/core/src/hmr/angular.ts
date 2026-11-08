/**
 * @devmirror/core - Angular CLI HMR Adapter
 * Handles Angular CLI Webpack Dev Server (/ng-cli-ws) and modern Vite-based builder.
 */

import type { TargetDevServer } from '@devmirror/shared';
import type { IHmrAdapter } from './types.js';

export class AngularHmrAdapter implements IHmrAdapter {
  public readonly framework = 'angular' as const;

  public matches(urlPath: string): boolean {
    const cleanPath = urlPath.split('?')[0];
    return (
      cleanPath === '/ng-cli-ws' ||
      cleanPath === '/@vite-hmr' ||
      cleanPath === '/' ||
      cleanPath === ''
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
    // Strip external origin so modern Vite-based Angular dev server accepts the connection
    delete normalized['origin'];

    return normalized;
  }
}
