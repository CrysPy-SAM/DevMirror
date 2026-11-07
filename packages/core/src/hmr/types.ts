/**
 * @devmirror/core - HMR Adapter Types
 */

import type { SupportedFramework, TargetDevServer } from '@devmirror/shared';

export interface HmrRouteMatch {
  isHmr: boolean;
  framework: SupportedFramework;
  path: string;
}

export interface IHmrAdapter {
  readonly framework: SupportedFramework;

  /**
   * Checks whether the request path matches this framework's HMR endpoint.
   */
  matches(urlPath: string): boolean;

  /**
   * Normalizes inbound WebSocket upgrade headers for the target dev server.
   */
  normalizeHeaders(
    headers: Record<string, string | string[] | undefined>,
    target: TargetDevServer
  ): Record<string, string>;
}
