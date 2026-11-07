/**
 * @devmirror/core - HMR Adapter Registry
 * Dispatches WebSocket upgrade requests to the matching framework HMR adapter.
 */

import type { SupportedFramework, TargetDevServer } from '@devmirror/shared';
import type { IHmrAdapter } from './types.js';
import { ViteHmrAdapter } from './vite.js';
import { NextjsHmrAdapter } from './nextjs.js';
import { AngularHmrAdapter } from './angular.js';
import { AstroHmrAdapter } from './astro.js';
import { NuxtHmrAdapter } from './nuxt.js';
import { CraHmrAdapter } from './cra.js';

export class HmrRegistry {
  private readonly adapters: Map<SupportedFramework, IHmrAdapter> = new Map();

  constructor() {
    this.register(new ViteHmrAdapter());
    this.register(new NextjsHmrAdapter());
    this.register(new AngularHmrAdapter());
    this.register(new AstroHmrAdapter());
    this.register(new NuxtHmrAdapter());
    this.register(new CraHmrAdapter());
  }

  public register(adapter: IHmrAdapter): void {
    this.adapters.set(adapter.framework, adapter);
  }

  public getAdapter(framework: SupportedFramework): IHmrAdapter | undefined {
    return this.adapters.get(framework);
  }

  /**
   * Finds the best matching adapter for an incoming WebSocket request path and target server.
   */
  public findAdapter(urlPath: string, target: TargetDevServer): IHmrAdapter {
    // 1. If target framework is explicitly configured and has an adapter matching or fallback
    const targetAdapter = this.adapters.get(target.framework);
    if (targetAdapter && targetAdapter.matches(urlPath)) {
      return targetAdapter;
    }

    // 2. Search all adapters by path matching
    for (const adapter of this.adapters.values()) {
      if (adapter.matches(urlPath)) {
        return adapter;
      }
    }

    // 3. Fallback generic adapter
    return {
      framework: target.framework,
      matches: () => true,
      normalizeHeaders: (headers, tgt) => {
        const normalized: Record<string, string> = {};
        for (const [key, value] of Object.entries(headers)) {
          if (value !== undefined) {
            normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
          }
        }
        normalized['host'] = `${tgt.host}:${tgt.port}`;
        const scheme = tgt.isHttps ? 'https' : 'http';
        normalized['origin'] = `${scheme}://${tgt.host}:${tgt.port}`;
        return normalized;
      }
    };
  }
}
