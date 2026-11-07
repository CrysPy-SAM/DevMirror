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

    const htmlWithBodyOnly = '<html><body><h1>No Head Tag</h1></body></html>';
    const result1 = await rewriter.process(Buffer.from(htmlWithBodyOnly), { 'content-type': 'text/html' });
    expect(result1.modified).toBe(true);
    const out1 = result1.body.toString('utf-8');
    expect(out1.indexOf('__devmirror/companion.js')).toBeLessThan(out1.indexOf('</body>'));

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

  it('should reuse existing CSP nonce and NOT broaden policy by adding self or unsafe-inline', async () => {
    const rewriter = new HtmlRewriter({
      enableOverlay: true,
      proxyPort: 4000,
      targetPort: 3000,
      framework: 'nextjs'
    });

    const upstreamNonce = 'StrictPreGeneratedNonce999';
    const rawHtml = '<html><head></head><body><h1>Existing Nonce App</h1></body></html>';
    // Highly restrictive CSP: specifically forbids 'self' on scripts
    const headers = {
      'content-type': 'text/html',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${upstreamNonce}' 'strict-dynamic'; connect-src https://api.mycompany.com`
    };

    const result = await rewriter.process(Buffer.from(rawHtml), headers, '127.0.0.1:4000');
    expect(result.modified).toBe(true);
    expect(result.nonceUsed).toBe(upstreamNonce);

    const patchedCsp = String(result.headers['content-security-policy']);
    // MUST NOT add 'self' to script-src
    expect(patchedCsp).not.toContain("script-src 'self'");
    expect(patchedCsp).not.toContain("'unsafe-inline'");
    // MUST preserve existing nonce and strict-dynamic
    expect(patchedCsp).toContain(`'nonce-${upstreamNonce}'`);
    expect(patchedCsp).toContain("'strict-dynamic'");

    // Connect-src must be narrowed to ONLY the targeted proxy WebSocket origin, not wildcard ws: or wss:
    expect(patchedCsp).not.toMatch(/\bws:(?!\/\/)/);
    expect(patchedCsp).not.toMatch(/\bwss:(?!\/\/)/);
    expect(patchedCsp).toContain('connect-src https://api.mycompany.com ws://127.0.0.1:4000');

    // Injected script must carry the exact upstream nonce
    const outHtml = result.body.toString('utf-8');
    expect(outHtml).toContain(`nonce="${upstreamNonce}"`);
  });

  it('should handle multiple Content-Security-Policy headers (string[]) preserving each policy', async () => {
    const rewriter = new HtmlRewriter({
      enableOverlay: true,
      proxyPort: 4000,
      targetPort: 5173,
      framework: 'vite'
    });

    const rawHtml = '<html><head></head><body><h1>Multiple Policies</h1></body></html>';
    const headers = {
      'content-type': 'text/html',
      'content-security-policy': [
        "default-src 'self'",
        "script-src 'nonce-sharedNonce123'; connect-src 'self'",
        "frame-ancestors 'none'"
      ]
    };

    const result = await rewriter.process(Buffer.from(rawHtml), headers, '127.0.0.1:4000');
    expect(result.modified).toBe(true);
    expect(result.nonceUsed).toBe('sharedNonce123');

    const policies = result.headers['content-security-policy'];
    expect(Array.isArray(policies)).toBe(true);
    expect(policies).toHaveLength(3);

    // Policy 1 (default-src 'self') receives script-src with the shared nonce
    expect(policies[0]).toContain(`'nonce-sharedNonce123'`);

    // Policy 2 preserves script-src nonce and adds exact targeted WebSocket origin
    expect(policies[1]).toContain(`'nonce-sharedNonce123'`);
    expect(policies[1]).toContain('ws://127.0.0.1:4000');
    expect(policies[1]).not.toContain("'unsafe-inline'");

    // Policy 3 untouched except required directives
    expect(policies[2]).toContain("frame-ancestors 'none'");
  });

  it('should handle multiple Content-Security-Policy-Report-Only headers separately', async () => {
    const rewriter = new HtmlRewriter({
      enableOverlay: true,
      proxyPort: 4000,
      targetPort: 5173,
      framework: 'vite'
    });

    const rawHtml = '<html><head></head><body><h1>Report Only App</h1></body></html>';
    const headers = {
      'content-type': 'text/html',
      'content-security-policy': "script-src https://trusted.com; connect-src 'self'",
      'content-security-policy-report-only': [
        "script-src https://analytics.com; report-uri /csp-report-1",
        "connect-src https://telemetry.com; report-uri /csp-report-2"
      ]
    };

    const result = await rewriter.process(Buffer.from(rawHtml), headers, '127.0.0.1:4000');
    expect(result.modified).toBe(true);

    const csp = String(result.headers['content-security-policy']);
    const reportPolicies = result.headers['content-security-policy-report-only'];

    expect(csp).toContain(`'nonce-${result.nonceUsed}'`);
    expect(csp).toContain('ws://127.0.0.1:4000');

    expect(Array.isArray(reportPolicies)).toBe(true);
    expect(reportPolicies[0]).toContain(`'nonce-${result.nonceUsed}'`);
    expect(reportPolicies[0]).toContain('/csp-report-1');
    expect(reportPolicies[1]).toContain('ws://127.0.0.1:4000');
    expect(reportPolicies[1]).toContain('/csp-report-2');
  });

  it('should patch <meta http-equiv="Content-Security-Policy"> in HTML using narrow target origin', async () => {
    const rewriter = new HtmlRewriter({
      enableOverlay: true,
      proxyPort: 4000,
      targetPort: 5173,
      framework: 'vite'
    });

    const rawHtml = `<html>
<head>
  <meta http-equiv="Content-Security-Policy" content="script-src https://cdn.example.com; connect-src 'self'">
  <title>Meta CSP App</title>
</head>
<body><h1>Hello</h1></body>
</html>`;

    const result = await rewriter.process(Buffer.from(rawHtml), { 'content-type': 'text/html' }, '127.0.0.1:4000');
    expect(result.modified).toBe(true);

    const outHtml = result.body.toString('utf-8');
    expect(outHtml).toContain(`'nonce-${result.nonceUsed}'`);
    expect(outHtml).toContain('ws://127.0.0.1:4000');
    expect(outHtml).not.toContain("'unsafe-inline'");
    expect(outHtml).toContain(`nonce="${result.nonceUsed}"`);
  });
});
