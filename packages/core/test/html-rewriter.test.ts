import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { HtmlRewriter, MAX_HTML_BUFFER_BYTES } from '../src/html/rewriter.js';

describe('HtmlRewriter Security & Edge Cases Audit', () => {
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

  it('should safely bypass rewriting when Content-Type header is missing', async () => {
    const rewriter = new HtmlRewriter({
      enableOverlay: true,
      proxyPort: 4000,
      targetPort: 5173,
      framework: 'vite'
    });

    const rawBuffer = Buffer.from('<html><head></head><body>No Content-Type</body></html>');
    const headers = {};

    const result = await rewriter.process(rawBuffer, headers);
    expect(result.modified).toBe(false);
    expect(result.body.toString('utf-8')).toBe(rawBuffer.toString('utf-8'));
  });

  it('should safely bypass rewriting when HTML exceeds 10MB limit', async () => {
    const rewriter = new HtmlRewriter({
      enableOverlay: true,
      proxyPort: 4000,
      targetPort: 5173,
      framework: 'vite'
    });

    // Create an oversized buffer > 10MB
    const oversizedBuffer = Buffer.alloc(MAX_HTML_BUFFER_BYTES + 1024, 'a');
    const headers = { 'content-type': 'text/html' };

    const result = await rewriter.process(oversizedBuffer, headers);
    expect(result.modified).toBe(false);
    expect(result.body.byteLength).toBe(oversizedBuffer.byteLength);
  });

  it('should safely inject DevMirror companion with nonce before </head>', async () => {
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
    expect(result.nonceUsed).toBeDefined();
    const outputHtml = result.body.toString('utf-8');

    // Injected before </head>
    expect(outputHtml).toContain('<!-- [DevMirror Injected Companion] -->');
    expect(outputHtml).toContain(`nonce="${result.nonceUsed}"`);
    expect(outputHtml).toContain('<script src="/__devmirror/companion.js"');
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

  it('should decompress and rewrite deflate-encoded HTML responses', async () => {
    const rewriter = new HtmlRewriter({
      enableOverlay: true,
      proxyPort: 4000,
      targetPort: 8080,
      framework: 'vanilla'
    });

    const rawHtml = '<html><head><title>Deflate</title></head><body>Deflate Compressed Content</body></html>';
    const deflateBuffer = zlib.deflateSync(Buffer.from(rawHtml, 'utf-8'));

    const headers = {
      'content-type': 'text/html',
      'content-encoding': 'deflate',
      'content-length': deflateBuffer.byteLength
    };

    const result = await rewriter.process(deflateBuffer, headers);

    expect(result.modified).toBe(true);
    expect(result.headers['content-encoding']).toBeUndefined();
    expect(result.headers['content-length']).toBe(result.body.byteLength);

    const outText = result.body.toString('utf-8');
    expect(outText).toContain('Deflate Compressed Content');
    expect(outText).toContain('__devmirror/companion.js');
  });

  it('should reuse existing CSP nonce when present without injecting unsafe-inline', async () => {
    const rewriter = new HtmlRewriter({
      enableOverlay: true,
      proxyPort: 4000,
      targetPort: 3000,
      framework: 'nextjs'
    });

    const upstreamNonce = 'ExistingPreGeneratedNonce1234';
    const rawHtml = '<html><head></head><body><h1>Existing Nonce App</h1></body></html>';
    const headers = {
      'content-type': 'text/html',
      'content-security-policy': `default-src 'self'; script-src 'self' 'nonce-${upstreamNonce}' 'strict-dynamic'; connect-src 'self'`
    };

    const result = await rewriter.process(Buffer.from(rawHtml), headers);
    expect(result.modified).toBe(true);
    expect(result.nonceUsed).toBe(upstreamNonce);

    const patchedCsp = String(result.headers['content-security-policy']);
    // Must NOT introduce unsafe-inline
    expect(patchedCsp).not.toContain("'unsafe-inline'");
    // Must preserve existing nonce and strict-dynamic
    expect(patchedCsp).toContain(`'nonce-${upstreamNonce}'`);
    expect(patchedCsp).toContain("'strict-dynamic'");
    // Must allow WebSocket in connect-src
    expect(patchedCsp).toContain('ws:');

    // Injected script must carry the exact upstream nonce
    const outHtml = result.body.toString('utf-8');
    expect(outHtml).toContain(`nonce="${upstreamNonce}"`);
  });

  it('should patch CSP and CSP-Report-Only headers separately', async () => {
    const rewriter = new HtmlRewriter({
      enableOverlay: true,
      proxyPort: 4000,
      targetPort: 5173,
      framework: 'vite'
    });

    const rawHtml = '<html><head></head><body><h1>Report Only App</h1></body></html>';
    const headers = {
      'content-type': 'text/html',
      'content-security-policy': "script-src 'self'; connect-src 'self'",
      'content-security-policy-report-only': "script-src 'self' https://analytics.com; report-uri /csp-report"
    };

    const result = await rewriter.process(Buffer.from(rawHtml), headers);
    expect(result.modified).toBe(true);

    const csp = String(result.headers['content-security-policy']);
    const cspReport = String(result.headers['content-security-policy-report-only']);

    expect(csp).toContain(`'nonce-${result.nonceUsed}'`);
    expect(csp).toContain('ws:');

    expect(cspReport).toContain(`'nonce-${result.nonceUsed}'`);
    expect(cspReport).toContain('report-uri /csp-report');
  });

  it('should patch <meta http-equiv="Content-Security-Policy"> in HTML using the nonce', async () => {
    const rewriter = new HtmlRewriter({
      enableOverlay: true,
      proxyPort: 4000,
      targetPort: 5173,
      framework: 'vite'
    });

    const rawHtml = `<html>
<head>
  <meta http-equiv="Content-Security-Policy" content="script-src 'self'; connect-src 'self'">
  <title>Meta CSP App</title>
</head>
<body><h1>Hello</h1></body>
</html>`;

    const result = await rewriter.process(Buffer.from(rawHtml), { 'content-type': 'text/html' });
    expect(result.modified).toBe(true);

    const outHtml = result.body.toString('utf-8');
    expect(outHtml).toContain(`'nonce-${result.nonceUsed}'`);
    expect(outHtml).toContain('ws:');
    expect(outHtml).toContain(`nonce="${result.nonceUsed}"`);
  });
});
