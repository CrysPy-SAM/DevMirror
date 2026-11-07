import { describe, it, expect } from 'vitest';
import { FrameworkDetector } from '../src/fingerprint/detector.js';

describe('FrameworkDetector', () => {
  describe('extractTitle', () => {
    it('should extract title tag content', () => {
      const html = '<!DOCTYPE html><html><head><title>My Awesome App</title></head><body></body></html>';
      expect(FrameworkDetector.extractTitle(html)).toBe('My Awesome App');
    });

    it('should handle whitespace inside title tag', () => {
      const html = '<title>   Trimmed App Title   </title>';
      expect(FrameworkDetector.extractTitle(html)).toBe('Trimmed App Title');
    });

    it('should return undefined if title is absent', () => {
      const html = '<!DOCTYPE html><html><head></head><body>No title here</body></html>';
      expect(FrameworkDetector.extractTitle(html)).toBeUndefined();
    });
  });

  describe('Next.js detection', () => {
    it('should detect Next.js with high confidence via X-Powered-By header', () => {
      const result = FrameworkDetector.detect(
        { 'x-powered-by': 'Next.js' },
        '<div id="__next">Hello</div>'
      );
      expect(result.framework).toBe('nextjs');
      expect(result.frameworkName).toBe('Next.js');
      expect(result.confidence).toBe('high');
    });

    it('should detect Next.js with high confidence via __NEXT_DATA__ marker', () => {
      const result = FrameworkDetector.detect(
        {},
        '<html><body><script id="__NEXT_DATA__" type="application/json">{}</script></body></html>'
      );
      expect(result.framework).toBe('nextjs');
      expect(result.confidence).toBe('high');
    });

    it('should detect Next.js with medium confidence via /_next/static/ bundle path', () => {
      const result = FrameworkDetector.detect(
        {},
        '<html><script src="/_next/static/chunks/main.js"></script></html>'
      );
      expect(result.framework).toBe('nextjs');
      expect(result.confidence).toBe('medium');
    });
  });

  describe('Nuxt detection', () => {
    it('should detect Nuxt with high confidence via X-Powered-By header', () => {
      const result = FrameworkDetector.detect({ 'x-powered-by': 'Nuxt' }, '');
      expect(result.framework).toBe('nuxt');
      expect(result.frameworkName).toBe('Nuxt');
      expect(result.confidence).toBe('high');
    });

    it('should detect Nuxt with high confidence via __NUXT__ marker', () => {
      const result = FrameworkDetector.detect(
        {},
        '<script>window.__NUXT__={};</script>'
      );
      expect(result.framework).toBe('nuxt');
      expect(result.confidence).toBe('high');
    });
  });

  describe('Vite detection', () => {
    it('should detect Vite with high confidence via Server header', () => {
      const result = FrameworkDetector.detect(
        { server: 'vite/5.1.0' },
        '<html><body>Hello</body></html>'
      );
      expect(result.framework).toBe('vite');
      expect(result.frameworkName).toBe('Vite');
      expect(result.confidence).toBe('high');
    });

    it('should detect Vite with high confidence via /@vite/client marker', () => {
      const result = FrameworkDetector.detect(
        {},
        '<html><head><script type="module" src="/@vite/client"></script></head></html>'
      );
      expect(result.framework).toBe('vite');
      expect(result.confidence).toBe('high');
    });

    it('should detect Vite with medium confidence via React preamble or main module', () => {
      const result = FrameworkDetector.detect(
        {},
        '<html><body><script type="module" src="/src/main.tsx"></script></body></html>'
      );
      expect(result.framework).toBe('vite');
      expect(result.confidence).toBe('medium');
    });
  });

  describe('Astro detection', () => {
    it('should detect Astro with high confidence via <astro-island> tag', () => {
      const result = FrameworkDetector.detect(
        {},
        '<astro-island uid="abc1234"></astro-island>'
      );
      expect(result.framework).toBe('astro');
      expect(result.frameworkName).toBe('Astro');
      expect(result.confidence).toBe('high');
    });

    it('should detect Astro with medium confidence via astro class marker', () => {
      const result = FrameworkDetector.detect(
        {},
        '<div class="astro-XYZ123">Content</div>'
      );
      expect(result.framework).toBe('astro');
      expect(result.confidence).toBe('medium');
    });
  });

  describe('Angular detection', () => {
    it('should detect Angular with high confidence via ng-version attribute', () => {
      const result = FrameworkDetector.detect(
        {},
        '<html><body><app-root ng-version="17.2.1">App</app-root></body></html>'
      );
      expect(result.framework).toBe('angular');
      expect(result.frameworkName).toBe('Angular');
      expect(result.confidence).toBe('high');
    });

    it('should detect Angular with medium confidence via <app-root> tag alone', () => {
      const result = FrameworkDetector.detect(
        {},
        '<html><body><app-root>Loading...</app-root></body></html>'
      );
      expect(result.framework).toBe('angular');
      expect(result.confidence).toBe('medium');
    });
  });

  describe('Create React App / Webpack detection', () => {
    it('should detect CRA via webpackHotDevClient marker', () => {
      const result = FrameworkDetector.detect(
        {},
        '<html><script src="/static/js/bundle.js"></script><script>webpackHotDevClient</script></html>'
      );
      expect(result.framework).toBe('cra');
      expect(result.frameworkName).toBe('Create React App');
      expect(result.confidence).toBe('medium');
    });
  });

  describe('Generic HTML and Unknown services', () => {
    it('should classify generic HTML as generic with low confidence', () => {
      const result = FrameworkDetector.detect(
        { 'content-type': 'text/html; charset=utf-8' },
        '<!DOCTYPE html><html><head><title>Static Site</title></head><body><h1>Hello World</h1></body></html>'
      );
      expect(result.framework).toBe('generic');
      expect(result.frameworkName).toBe('Generic HTTP Server');
      expect(result.confidence).toBe('low');
      expect(result.title).toBe('Static Site');
    });

    it('should classify unrecognized response as unknown with low confidence', () => {
      const result = FrameworkDetector.detect(
        { 'content-type': 'application/json' },
        '{"status":"ok"}'
      );
      expect(result.framework).toBe('unknown');
      expect(result.frameworkName).toBe('Unknown Service');
      expect(result.confidence).toBe('low');
    });
  });
});
