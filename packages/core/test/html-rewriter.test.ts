import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { HtmlRewriter, MAX_HTML_BUFFER_BYTES } from '../src/html/rewriter.js';

describe('HtmlRewriter', () => {
  it('should not modify HTML when enableOverlay is false (default pass-through)', async () => {
    const rewriter = new HtmlRewriter({
      enableOverlay: false,
      proxyPort: 4000,
      targetPort: 5173,
      framework: 'vite'
    });

    const rawHtml = '<html><head><title>Test</title></head><body><h1>Hello</h1></body></html>';
    const rawBuffer = Buffer.from(rawHtml, 'utf-8');
    const headers = { 'content-type': 'text/html; charset=utf-8', 'content-length': rawBuffer.length };

    const result = await rewriter.process(rawBuffer, headers);

    expect(result.modified).toBe(false);
    expect(result.body.toString('utf-8')).toBe(rawHtml);
    expect(result.headers['content-length']).toBe(rawBuffer.length);
  });

  it('should not modify non-HTML responses even when enableOverlay is true', async () => {
    const rewriter = new HtmlRewriter({
      enableOverlay: true,
      proxyPort: 4000,
      targetPort: 5173,
      framework: 'vite'
    });

    const jsonStr = JSON.stringify({ ok: true, data: 'test' });
    const buffer = Buffer.from(jsonStr, 'utf-8');
    const headers = { 'content-type': 'application/json' };

    const result = await rewriter.process(buffer, headers);

    expect(result.modified).toBe(false);
    expect(result.body.toString('utf-8')).toBe(jsonStr);
  });

  it('should safely inject DevMirror companion before </head>', async () => {
    const rewriter = new HtmlRewriter({
      enableOverlay: true,
      proxyPort: 4000,
      targetPort: 5173,
      framework: 'vite'
    });

    const rawHtml = '<!DOCTYPE html><html><head><title>App</title></head><body><div id="root"></div></body></html>';
    const rawBuffer = Buffer.from(rawHtml, 'utf-8');
    const headers = { 'content-type': 'text/html' };

    const result = await rewriter.process(rawBuffer, headers);

    expect(result.modified).toBe(true);
    const outputHtml = result.body.toString('utf-8');

    // Injected before </head>
    expect(outputHtml).toContain('<!-- [DevMirror Injected Companion] -->');
    expect(outputHtml).toContain('window.__DEVMIRROR__ = Object.freeze({"proxyPort":4000,"targetPort":5173,"framework":"vite"});');
    expect(outputHtml).toContain('<script src="/__devmirror/companion.js" defer></script>');
    expect(outputHtml.indexOf('__devmirror/companion.js')).toBeLessThan(outputHtml.indexOf('</head>'));
    expect(result.headers['content-length']).toBe(result.body.byteLength);
  });

  it('should handle missing </head> by injecting before </body> or appending', async () => {
    const rewriter = new HtmlRewriter({
      enableOverlay: true,
      proxyPort: 4000,
      targetPort: 3000,
      framework: 'nextjs'
    });

    // Missing </head>, has </body>
    const htmlWithBodyOnly = '<html><body><h1>No Head Tag</h1></body></html>';
    const result1 = await rewriter.process(Buffer.from(htmlWithBodyOnly), { 'content-type': 'text/html' });
    expect(result1.modified).toBe(true);
    const out1 = result1.body.toString('utf-8');
    expect(out1.indexOf('__devmirror/companion.js')).toBeLessThan(out1.indexOf('</body>'));

    // Missing both </head> and </body>
    const fragmentHtml = '<div>Snippet only</div>';
    const result2 = await rewriter.process(Buffer.from(fragmentHtml), { 'content-type': 'text/html' });
    expect(result2.modified).toBe(true);
    expect(result2.body.toString('utf-8')).toContain('__devmirror/companion.js');
  });

  it('should decompress and rewrite gzip-encoded HTML responses', async () => {
    const rewriter = new HtmlRewriter({
      enableOverlay: true,
      proxyPort: 4000,
      targetPort: 5173,
      framework: 'vite'
    });

    const rawHtml = '<html><head><title>Gzip</title></head><body>Compressed Content</body></html>';
    const gzippedBuffer = zlib.gzipSync(Buffer.from(rawHtml, 'utf-8'));

    const headers = {
      'content-type': 'text/html',
      'content-encoding': 'gzip',
      'content-length': gzippedBuffer.byteLength
    };

    const result = await rewriter.process(gzippedBuffer, headers);

    expect(result.modified).toBe(true);
    // Content-Encoding must be removed since the rewritten body is uncompressed HTML
    expect(result.headers['content-encoding']).toBeUndefined();
    expect(result.headers['content-length']).toBe(result.body.byteLength);

    const outText = result.body.toString('utf-8');
    expect(outText).toContain('Compressed Content');
    expect(outText).toContain('__devmirror/companion.js');
  });

  it('should decompress and rewrite brotli-encoded HTML responses', async () => {
    const rewriter = new HtmlRewriter({
      enableOverlay: true,
      proxyPort: 4000,
      targetPort: 4200,
      framework: 'angular'
    });

    const rawHtml = '<html><head><title>Brotli</title></head><body>Brotli Compressed App</body></html>';
    const brotliBuffer = zlib.brotliCompressSync(Buffer.from(rawHtml, 'utf-8'));

    const headers = {
      'content-type': 'text/html',
      'content-encoding': 'br',
      'content-length': brotliBuffer.byteLength
    };

    const result = await rewriter.process(brotliBuffer, headers);

    expect(result.modified).toBe(true);
    expect(result.headers['content-encoding']).toBeUndefined();
    expect(result.headers['content-length']).toBe(result.body.byteLength);

    const outText = result.body.toString('utf-8');
    expect(outText).toContain('Brotli Compressed App');
    expect(outText).toContain('__devmirror/companion.js');
  });

  it('should patch Content-Security-Policy to allow inline script and WebSocket connection', async () => {
    const rewriter = new HtmlRewriter({
      enableOverlay: true,
      proxyPort: 4000,
      targetPort: 5173,
      framework: 'vite'
    });

    const rawHtml = '<html><head></head><body><h1>CSP Test</h1></body></html>';
    const headers = {
      'content-type': 'text/html',
      'content-security-policy': "default-src 'self'; script-src 'self' https://trusted.com; connect-src 'self'"
    };

    const result = await rewriter.process(Buffer.from(rawHtml), headers);
    expect(result.modified).toBe(true);

    const patchedCsp = String(result.headers['content-security-policy']);
    expect(patchedCsp).toContain("'unsafe-inline'");
    expect(patchedCsp).toContain('ws:');
  });
});
