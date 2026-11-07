/**
 * @devmirror/scanner - Framework Detector
 * Fingerprints web development frameworks from HTTP response headers and HTML body markers.
 */

import type { DetectedFramework, DetectionConfidence } from '../types.js';

export interface FingerprintResult {
  framework: DetectedFramework;
  frameworkName: string;
  confidence: DetectionConfidence;
  title?: string;
}

export class FrameworkDetector {
  /**
   * Extracts HTML title tag content if present in body snippet.
   */
  public static extractTitle(html: string): string | undefined {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match ? match[1].trim() : undefined;
  }

  /**
   * Identifies the framework from response headers and body content.
   */
  public static detect(
    headers: Record<string, string> = {},
    body: string = ''
  ): FingerprintResult {
    const title = FrameworkDetector.extractTitle(body);
    const poweredBy = (headers['x-powered-by'] || '').toLowerCase();
    const serverHeader = (headers['server'] || '').toLowerCase();

    // 1. Next.js
    if (
      poweredBy.includes('next.js') ||
      body.includes('__NEXT_DATA__') ||
      body.includes('/_next/static/') ||
      body.includes('/_next/webpack-hmr') ||
      body.includes('<div id="__next">')
    ) {
      const confidence: DetectionConfidence =
        poweredBy.includes('next.js') || body.includes('__NEXT_DATA__') ? 'high' : 'medium';
      return { framework: 'nextjs', frameworkName: 'Next.js', confidence, title };
    }

    // 2. Nuxt
    if (
      poweredBy.includes('nuxt') ||
      body.includes('__NUXT__') ||
      body.includes('__NUXT_DATA__') ||
      body.includes('/_nuxt/') ||
      body.includes('<div id="__nuxt">') ||
      body.includes('id="__nuxt"')
    ) {
      const confidence: DetectionConfidence =
        poweredBy.includes('nuxt') || body.includes('__NUXT__') || body.includes('__NUXT_DATA__')
          ? 'high'
          : 'medium';
      return { framework: 'nuxt', frameworkName: 'Nuxt', confidence, title };
    }

    // 3. Astro (must precede generic Vite because Astro uses Vite under the hood)
    if (
      headers['x-astro'] ||
      body.includes('<astro-island') ||
      body.includes('astro-island[') ||
      body.includes('Astro.generator') ||
      body.includes('data-astro-cid-') ||
      body.includes('data-astro-source-file') ||
      body.includes('class="astro-') ||
      body.includes('<!--astro:')
    ) {
      const confidence: DetectionConfidence =
        body.includes('<astro-island') || body.includes('Astro.generator') || headers['x-astro']
          ? 'high'
          : 'medium';
      return { framework: 'astro', frameworkName: 'Astro', confidence, title };
    }

    // 4. Angular
    if (
      body.includes('ng-version="') ||
      body.includes('<app-root') ||
      body.includes('/ng-cli-ws')
    ) {
      const confidence: DetectionConfidence =
        body.includes('ng-version="') || body.includes('/ng-cli-ws') ? 'high' : 'medium';
      return { framework: 'angular', frameworkName: 'Angular', confidence, title };
    }

    // 5. Create React App (CRA) / Webpack React
    if (
      body.includes('webpackHotDevClient') ||
      (body.includes('<div id="root">') && body.includes('/static/js/bundle.js')) ||
      (body.includes('react-scripts') && body.includes('<div id="root">')) ||
      (body.includes('<div id="root">') && body.includes('/static/js/main.chunk.js'))
    ) {
      return { framework: 'cra', frameworkName: 'Create React App', confidence: 'medium', title };
    }

    // 6. Vite (React, Vue, Svelte, Vanilla)
    if (
      serverHeader.includes('vite') ||
      body.includes('/@vite/client') ||
      body.includes('window.__vite_plugin_react_preamble_installed__') ||
      body.includes('/@react-refresh') ||
      body.includes('/@fs/') ||
      body.includes('/@vite-hmr') ||
      body.includes('type="module" src="/src/main.') ||
      body.includes('type="module" src="/src/index.')
    ) {
      const confidence: DetectionConfidence =
        body.includes('/@vite/client') || serverHeader.includes('vite') ? 'high' : 'medium';
      return { framework: 'vite', frameworkName: 'Vite', confidence, title };
    }

    // 7. Generic HTML / Static Dev Server
    if (body.includes('<html') || body.includes('<!DOCTYPE html>') || headers['content-type']?.includes('text/html')) {
      return { framework: 'generic', frameworkName: 'Generic HTTP Server', confidence: 'low', title };
    }

    return { framework: 'unknown', frameworkName: 'Unknown Service', confidence: 'low', title };
  }
}
