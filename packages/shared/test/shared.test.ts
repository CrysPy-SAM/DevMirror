import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PROXY_PORT,
  DEFAULT_CONTROL_PORT,
  SESSION_COOKIE_NAME,
  SESSION_QUERY_PARAM,
  COMMON_DEV_PORTS,
  FRAMEWORK_HMR_PATHS,
  maskToken,
  sanitizeUrlForLogging
} from '../src/index.js';

describe('@devmirror/shared', () => {
  describe('Constants', () => {
    it('should define default ports according to architectural decisions', () => {
      expect(DEFAULT_PROXY_PORT).toBe(4000);
      expect(DEFAULT_CONTROL_PORT).toBe(4100);
    });

    it('should define expected cookie and query parameter names', () => {
      expect(SESSION_COOKIE_NAME).toBe('dm_session');
      expect(SESSION_QUERY_PARAM).toBe('dm_token');
    });

    it('should include top web dev ports in common port list', () => {
      expect(COMMON_DEV_PORTS).toContain(5173); // Vite
      expect(COMMON_DEV_PORTS).toContain(3000); // Next.js
      expect(COMMON_DEV_PORTS).toContain(4200); // Angular
      expect(COMMON_DEV_PORTS).toContain(8080); // Webpack
    });

    it('should map framework HMR paths properly', () => {
      expect(FRAMEWORK_HMR_PATHS.vite).toContain('/@vite-hmr');
      expect(FRAMEWORK_HMR_PATHS.nextjs).toContain('/_next/webpack-hmr');
      expect(FRAMEWORK_HMR_PATHS.angular).toContain('/ng-cli-ws');
    });
  });

  describe('Security & Sanitization Helpers', () => {
    it('should mask tokens correctly without exposing inner secret', () => {
      expect(maskToken(undefined)).toBe('***');
      expect(maskToken(null)).toBe('***');
      expect(maskToken('')).toBe('***');
      expect(maskToken('short')).toBe('********');
      expect(maskToken('abcdef1234567890abcdef1234567890')).toBe('abcd...7890');
    });

    it('should sanitize URLs for safe logging by removing session tokens', () => {
      const sensitiveUrl = '/?dm_token=supersecrettoken1234567890&debug=true';
      const sanitized = sanitizeUrlForLogging(sensitiveUrl);
      expect(sanitized).not.toContain('supersecrettoken1234567890');
      expect(sanitized).toContain('dm_token=[REDACTED]');
      expect(sanitized).toContain('debug=true');
    });

    it('should handle malformed URLs gracefully when sanitizing', () => {
      const brokenUrl = 'invalid://url??dm_token=leakthis';
      const sanitized = sanitizeUrlForLogging(brokenUrl);
      expect(sanitized).not.toContain('leakthis');
      expect(sanitized).toContain('[REDACTED]');
    });
  });
});
