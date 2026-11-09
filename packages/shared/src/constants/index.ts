/**
 * DevMirror Shared Constants & Protocol Definitions
 */

export const DEFAULT_PROXY_PORT = 4000;
export const DEFAULT_CONTROL_PORT = 4100;
export const MAX_PORT_FALLBACK_ATTEMPTS = 50;

export const SESSION_COOKIE_NAME = 'dm_session';
export const SESSION_QUERY_PARAM = 'dm_token';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export const CONTROL_API_AUTH_HEADER = 'x-devmirror-token';
export const CONTROL_API_CSRF_HEADER = 'x-devmirror-csrf';
export const CONTROL_API_CLI_HEADER = 'x-devmirror-cli';

/**
 * Deterministic Development Chrome Extension Identity
 * Derived from the RSA 2048-bit SPKI public key embedded in apps/extension/manifest.json.
 * Production extension IDs are explicitly configured and must never use unverified placeholders.
 */
export const DEVMIRROR_DEV_EXTENSION_ID = 'kmcaoghdokfdbadplofpkeabloldmoga';
export const DEVMIRROR_DEV_EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1PyF+IbBRgixwhFyBthP93Oqzw7Rcp85hCjbptJqV0pAPQGX5ZTEMSIbgb6f3KSp6Em7qu7Tt9vib1KVKqf47BJNTqWTfJ4PgvIl0Xn4BFZdsm6g+/xGUru2hLHIOh8FzVn5w3r3PgbsWDriOW/HjK9HY0Sk1k35Jw9HzOiThOMDRT8pr339uZrNLVSPMG1tHq/fVNPItU+kW87co3ZhdF+IQi3hixVaVHd2Hpvz+zCmCgcnE+jgj3b2htEhE8wBK1iFI1095w6Degsf9LjgTi9IjT2qrtOKYb8rtUoOeYHmABgD2nahsBj2Lev6DmgQLMTvZEN+bB3eJCjB1IK81wIDAQAB';

export const COMMON_DEV_PORTS = [
  3000, // Next.js / CRA / Nuxt
  3001, // Next.js / CRA fallback
  4000, // Express / DevMirror proxy default
  4173, // Vite preview
  4200, // Angular CLI
  4321, // Astro
  5000, // Serve / SvelteKit
  5173, // Vite default
  5174, // Vite fallback
  5500, // VS Code Live Server
  8000, // Django / Astro / Python
  8080, // Webpack / Vue CLI
  8081, // Webpack fallback
  9000  // PHP / Webpack / Gulp
] as const;

export const FRAMEWORK_HMR_PATHS = {
  vite: ['/@vite-hmr', '/@vite/client'],
  nextjs: ['/_next/webpack-hmr', '/_next/'],
  angular: ['/ng-cli-ws'],
  vanilla: ['/ws', '/live-server']
} as const;

export const COMPANION_OVERLAY_PATH = '/__devmirror/companion.js';
export const COMPANION_WS_PATH = '/__devmirror/ws';
export const PUBLIC_AUTH_ENDPOINT = '/__devmirror/auth';

/**
 * Utility to redact sensitive tokens in application logs and diagnostics.
 * Preserves first 4 and last 4 characters for debugging, masks the rest.
 */
export function maskToken(token: string | null | undefined): string {
  if (!token) return '***';
  if (token.length <= 8) return '********';
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

/**
 * Strips or redacts query parameter tokens from a URL string for safe logging.
 */
export function sanitizeUrlForLogging(urlStr: string): string {
  try {
    // Redact any occurrence of dm_token=<value> using regex first for absolute safety
    const sanitized = urlStr.replace(
      new RegExp(`([?&]${SESSION_QUERY_PARAM}=)[^&#\\s]+`, 'g'),
      '$1[REDACTED]'
    );
    // If it's a valid URL, return standard pathname + search
    const parsed = new URL(sanitized, 'http://dummy.local');
    return parsed.pathname + parsed.search;
  } catch {
    return urlStr.replace(
      new RegExp(`([?&]${SESSION_QUERY_PARAM}=)[^&#\\s]+`, 'g'),
      '$1[REDACTED]'
    );
  }
}
