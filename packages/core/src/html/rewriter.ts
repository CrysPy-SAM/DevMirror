/**
 * @devmirror/core - HTML Rewriter & Decompression Pipeline
 * Injects the DevMirror companion runtime safely before </head>, handling gzip/brotli decompression,
 * strict CSP nonces, and edge cases.
 */

import zlib from 'node:zlib';
import crypto from 'node:crypto';
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
  proxyHost?: string;
}

export interface RewriteResult {
  body: Buffer;
  headers: Record<string, string | number | string[]>;
  modified: boolean;
  nonceUsed?: string;
}

export const MAX_HTML_BUFFER_BYTES = 10 * 1024 * 1024; // 10MB limit

export class HtmlRewriter {
  private readonly options: HtmlRewriterOptions;

  constructor(options: HtmlRewriterOptions) {
    this.options = options;
  }

  /**
   * Extracts an existing cryptographic nonce from <meta http-equiv="Content-Security-Policy"> if present.
   */
  public static extractMetaNonce(html: string): string | null {
    const match = html.match(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*content=(?:"([^"]*)"|'([^']*)')/i);
    if (match) {
      const content = match[1] ?? match[2];
      return HtmlRewriter.extractExistingNonce(content);
    }
    return null;
  }

  /**
   * Extracts an existing cryptographic nonce from CSP headers if one is already present.
   * Handles both single policy strings and arrays of policies.
   */
  public static extractExistingNonce(cspHeader: string | string[] | undefined): string | null {
    if (!cspHeader) return null;
    const policies = Array.isArray(cspHeader) ? cspHeader : [cspHeader];

    for (const policy of policies) {
      const match = policy.match(/script-src[^;]*'nonce-([A-Za-z0-9+/=_-]+)'/i);
      if (match) return match[1];
    }

    return null;
  }

  /**
   * Patches Content-Security-Policy with the narrowest possible scope:
   * - Uses a cryptographic nonce ('nonce-<nonce>') ONLY. Never adds 'unsafe-inline'.
   * - Never injects 'self' into script-src unless 'self' was already authorized, preventing policy broadening.
   * - Scopes connect-src strictly to the exact DevMirror WebSocket origin (ws://<proxyHost>),
   *   avoiding wildcard ws: or wss: permissions.
   * - Preserves all existing directives and directives' order.
   */
  public static patchCsp(cspHeader: string, nonce: string, targetWsOrigin: string): string {
    const directives = cspHeader.split(';').map((d) => d.trim()).filter(Boolean);

    let hasScriptSrc = false;
    let hasConnectSrc = false;
    const nonceDirective = `'nonce-${nonce}'`;

    const updatedDirectives = directives.map((directive) => {
      // 1. Script directive
      if (/^script-src\b/i.test(directive)) {
        hasScriptSrc = true;
        let updated = directive;
        if (!updated.includes(nonceDirective)) {
          updated += ` ${nonceDirective}`;
        }
        // Do NOT add 'self' or 'unsafe-inline'
        return updated;
      }

      // 2. Connect directive (targeted WebSocket connection only)
      if (/^connect-src\b/i.test(directive)) {
        hasConnectSrc = true;
        let updated = directive;
        if (!updated.includes(targetWsOrigin)) {
          updated += ` ${targetWsOrigin}`;
        }
        return updated;
      }

      return directive;
    });

    if (!hasScriptSrc) {
      // If no script-src exists, authorize strictly the nonce
      updatedDirectives.push(`script-src ${nonceDirective}`);
    }
    if (!hasConnectSrc) {
      // If no connect-src exists, authorize strictly 'self' and the exact WebSocket origin
      updatedDirectives.push(`connect-src 'self' ${targetWsOrigin}`);
    }

    return updatedDirectives.join('; ');
  }

  /**
   * Patches any <meta http-equiv="Content-Security-Policy" content="..."> tags in the HTML string.
   */
  public static patchMetaCsp(html: string, nonce: string, targetWsOrigin: string): string {
    return html.replace(
      /(<meta\s+[^>]*http-equiv=["']Content-Security-Policy["'][^>]*content=)(?:"([^"]*)"|'([^']*)')([^>]*>)/gi,
      (_match, prefix, contentDouble, contentSingle, suffix) => {
        const isDouble = contentDouble !== undefined;
        const content = isDouble ? contentDouble : contentSingle;
        const quote = isDouble ? '"' : "'";
        const patchedContent = HtmlRewriter.patchCsp(content, nonce, targetWsOrigin);
        return `${prefix}${quote}${patchedContent}${quote}${suffix}`;
      }
    );
  }

  /**
   * Generates safe companion script tags to inject with cryptographic nonce.
   */
  public generateInjectionPayload(nonce?: string): string {
    const safeConfig = {
      proxyPort: this.options.proxyPort,
      targetPort: this.options.targetPort,
      framework: this.options.framework
    };

    const nonceAttr = nonce ? ` nonce="${nonce}"` : '';

    return `\n<!-- [DevMirror Injected Companion] -->
<script id="__devmirror_runtime"${nonceAttr}>
  window.__DEVMIRROR__ = Object.freeze(${JSON.stringify(safeConfig)});
</script>
<script src="/__devmirror/companion.js"${nonceAttr} defer></script>\n`;
  }

  /**
   * Injects the script snippet before </head>, </body>, or at the end.
   */
  public injectScript(html: string, nonce?: string, targetWsOrigin?: string): string {
    let workingHtml = html;
    if (nonce && targetWsOrigin) {
      workingHtml = HtmlRewriter.patchMetaCsp(workingHtml, nonce, targetWsOrigin);
    }

    const payload = this.generateInjectionPayload(nonce);

    // 1. Try before </head>
    const headIndex = workingHtml.search(/<\/head>/i);
    if (headIndex !== -1) {
      return workingHtml.slice(0, headIndex) + payload + workingHtml.slice(headIndex);
    }

    // 2. Try before </body>
    const bodyIndex = workingHtml.search(/<\/body>/i);
    if (bodyIndex !== -1) {
      return workingHtml.slice(0, bodyIndex) + payload + workingHtml.slice(bodyIndex);
    }

    // 3. Fallback: append to end
    return workingHtml + payload;
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
    rawHeaders: Record<string, string | number | string[] | undefined>,
    hostContext?: string
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

    // Edge case: missing Content-Type or non-HTML responses
    const rawContentType = headers['content-type'];
    if (!rawContentType) {
      return { body: rawBuffer, headers, modified: false };
    }

    const contentType = String(rawContentType).toLowerCase();
    if (!contentType.includes('text/html')) {
      return { body: rawBuffer, headers, modified: false };
    }

    // Edge case: Safety check on buffer size (> 10MB safely bypasses rewriting)
    if (rawBuffer.byteLength > MAX_HTML_BUFFER_BYTES) {
      return { body: rawBuffer, headers, modified: false };
    }

    try {
      const contentEncoding = headers['content-encoding'] ? String(headers['content-encoding']) : undefined;
      const decompressedBuffer = await this.decompress(rawBuffer, contentEncoding);
      const htmlText = decompressedBuffer.toString('utf-8');

      // Determine the exact, narrow WebSocket target origin (ws://<host>)
      const effectiveHost =
        hostContext ||
        this.options.proxyHost ||
        (headers['host'] ? String(headers['host']) : `127.0.0.1:${this.options.proxyPort}`);
      const targetWsOrigin = `ws://${effectiveHost}`;

      // Determine nonce strategy:
      // Reuse existing nonce if present in any CSP policy or <meta> tag; otherwise generate a fresh CSPRNG nonce
      const existingCsp = headers['content-security-policy'] as string | string[] | undefined;
      const detectedNonce = HtmlRewriter.extractExistingNonce(existingCsp) || HtmlRewriter.extractMetaNonce(htmlText);
      const nonceToUse = detectedNonce || crypto.randomBytes(16).toString('base64');

      const transformedHtml = this.injectScript(htmlText, nonceToUse, targetWsOrigin);
      const transformedBuffer = Buffer.from(transformedHtml, 'utf-8');

      // Update headers:
      // Output is decompressed UTF-8 HTML with a known length, so remove Content-Encoding and Transfer-Encoding
      delete headers['content-encoding'];
      delete headers['transfer-encoding'];
      headers['content-length'] = transformedBuffer.byteLength;

      // Handle multiple CSP headers (arrays) and single strings separately
      if (headers['content-security-policy']) {
        const raw = headers['content-security-policy'];
        if (Array.isArray(raw)) {
          headers['content-security-policy'] = raw.map((policy) =>
            HtmlRewriter.patchCsp(String(policy), nonceToUse, targetWsOrigin)
          );
        } else {
          headers['content-security-policy'] = HtmlRewriter.patchCsp(String(raw), nonceToUse, targetWsOrigin);
        }
      }

      // Handle multiple CSP-Report-Only headers separately
      if (headers['content-security-policy-report-only']) {
        const rawReport = headers['content-security-policy-report-only'];
        if (Array.isArray(rawReport)) {
          headers['content-security-policy-report-only'] = rawReport.map((policy) =>
            HtmlRewriter.patchCsp(String(policy), nonceToUse, targetWsOrigin)
          );
        } else {
          headers['content-security-policy-report-only'] = HtmlRewriter.patchCsp(
            String(rawReport),
            nonceToUse,
            targetWsOrigin
          );
        }
      }

      return {
        body: transformedBuffer,
        headers,
        modified: true,
        nonceUsed: nonceToUse
      };
    } catch {
      // If decompression or transformation fails, safely return the raw buffer
      return { body: rawBuffer, headers, modified: false };
    }
  }
}
