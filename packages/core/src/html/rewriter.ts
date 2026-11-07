/**
 * @devmirror/core - HTML Rewriter & Decompression Pipeline
 * Injects the DevMirror companion runtime safely before </head>, handling gzip/brotli decompression and CSP.
 */

import zlib from 'node:zlib';
import { promisify } from 'node:util';
import type { SupportedFramework } from '@devmirror/shared';

const gunzipAsync = promisify(zlib.gunzip);
const brotliDecompressAsync = promisify(zlib.brotliDecompress);
const inflateAsync = promisify(zlib.inflate);

export interface HtmlRewriterOptions {
  enableOverlay: boolean; // default MUST be false
  proxyPort: number;
  targetPort: number;
  framework: SupportedFramework;
}

export interface RewriteResult {
  body: Buffer;
  headers: Record<string, string | number | string[]>;
  modified: boolean;
}

export const MAX_HTML_BUFFER_BYTES = 10 * 1024 * 1024; // 10MB limit

export class HtmlRewriter {
  private readonly options: HtmlRewriterOptions;

  constructor(options: HtmlRewriterOptions) {
    this.options = options;
  }

  /**
   * Patches Content-Security-Policy header to permit DevMirror's companion script and WebSocket.
   */
  public static patchCsp(cspHeader: string): string {
    let directives = cspHeader.split(';').map((d) => d.trim()).filter(Boolean);

    let hasScriptSrc = false;
    let hasConnectSrc = false;

    directives = directives.map((directive) => {
      if (/^script-src\b/i.test(directive)) {
        hasScriptSrc = true;
        // Ensure 'unsafe-inline' and 'self' are allowed
        let updated = directive;
        if (!updated.includes("'unsafe-inline'")) updated += " 'unsafe-inline'";
        if (!updated.includes("'self'")) updated += " 'self'";
        return updated;
      }

      if (/^connect-src\b/i.test(directive)) {
        hasConnectSrc = true;
        let updated = directive;
        if (!updated.includes('ws:')) updated += ' ws:';
        if (!updated.includes("'self'")) updated += " 'self'";
        return updated;
      }

      return directive;
    });

    if (!hasScriptSrc) {
      directives.push("script-src 'self' 'unsafe-inline'");
    }
    if (!hasConnectSrc) {
      directives.push("connect-src 'self' ws:");
    }

    return directives.join('; ');
  }

  /**
   * Generates the safe companion script tags to inject.
   */
  public generateInjectionPayload(): string {
    const safeConfig = {
      proxyPort: this.options.proxyPort,
      targetPort: this.options.targetPort,
      framework: this.options.framework
    };

    return `\n<!-- [DevMirror Injected Companion] -->
<script id="__devmirror_runtime">
  window.__DEVMIRROR__ = Object.freeze(${JSON.stringify(safeConfig)});
</script>
<script src="/__devmirror/companion.js" defer></script>\n`;
  }

  /**
   * Injects the script snippet before </head>, </body>, or at the end.
   */
  public injectScript(html: string): string {
    const payload = this.generateInjectionPayload();

    // 1. Try before </head>
    const headIndex = html.search(/<\/head>/i);
    if (headIndex !== -1) {
      return html.slice(0, headIndex) + payload + html.slice(headIndex);
    }

    // 2. Try before </body>
    const bodyIndex = html.search(/<\/body>/i);
    if (bodyIndex !== -1) {
      return html.slice(0, bodyIndex) + payload + html.slice(bodyIndex);
    }

    // 3. Fallback: append to end
    return html + payload;
  }

  /**
   * Decompresses an encoded buffer based on Content-Encoding header.
   */
  public async decompress(buffer: Buffer, encoding: string | undefined): Promise<Buffer> {
    if (!encoding) return buffer;

    const lower = encoding.toLowerCase().trim();
    if (lower === 'gzip') {
      return gunzipAsync(buffer);
    }
    if (lower === 'br') {
      return brotliDecompressAsync(buffer);
    }
    if (lower === 'deflate') {
      return inflateAsync(buffer);
    }

    return buffer;
  }

  /**
   * Processes response body and headers.
   */
  public async process(
    rawBuffer: Buffer,
    rawHeaders: Record<string, string | number | string[] | undefined>
  ): Promise<RewriteResult> {
    const headers: Record<string, string | number | string[]> = {};
    for (const [k, v] of Object.entries(rawHeaders)) {
      if (v !== undefined) {
        headers[k.toLowerCase()] = v;
      }
    }

    // If overlay is disabled, return untouched pass-through
    if (!this.options.enableOverlay) {
      return { body: rawBuffer, headers, modified: false };
    }

    // Only process text/html
    const contentType = String(headers['content-type'] || '');
    if (!contentType.toLowerCase().includes('text/html')) {
      return { body: rawBuffer, headers, modified: false };
    }

    // Safety check on buffer size
    if (rawBuffer.byteLength > MAX_HTML_BUFFER_BYTES) {
      return { body: rawBuffer, headers, modified: false };
    }

    try {
      const contentEncoding = headers['content-encoding'] ? String(headers['content-encoding']) : undefined;
      const decompressedBuffer = await this.decompress(rawBuffer, contentEncoding);
      const htmlText = decompressedBuffer.toString('utf-8');

      const transformedHtml = this.injectScript(htmlText);
      const transformedBuffer = Buffer.from(transformedHtml, 'utf-8');

      // Update headers:
      // Output is decompressed UTF-8 HTML, so remove Content-Encoding
      delete headers['content-encoding'];
      headers['content-length'] = transformedBuffer.byteLength;

      // Handle CSP
      if (headers['content-security-policy']) {
        headers['content-security-policy'] = HtmlRewriter.patchCsp(String(headers['content-security-policy']));
      }
      if (headers['content-security-policy-report-only']) {
        headers['content-security-policy-report-only'] = HtmlRewriter.patchCsp(
          String(headers['content-security-policy-report-only'])
        );
      }

      return {
        body: transformedBuffer,
        headers,
        modified: true
      };
    } catch {
      // If decompression or transformation fails, safely return the raw buffer
      return { body: rawBuffer, headers, modified: false };
    }
  }
}
