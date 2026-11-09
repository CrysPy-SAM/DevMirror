/**
 * @devmirror/core - Host and Origin Formatting Utilities
 * Standardizes IPv4, IPv6, and hostname formatting for HTTP Host headers and URLs.
 */

/**
 * Strips outer brackets from an IPv6 address if present.
 * E.g. '[::1]' -> '::1', '127.0.0.1' -> '127.0.0.1'.
 */
export function cleanHostName(host: string): string {
  return host.trim().replace(/^\[|\]$/g, '');
}

/**
 * Formats a host and optional port for use in HTTP Host headers, Origin headers, and URLs.
 * If the host is an IPv6 address (contains colons), it is safely enclosed in square brackets per RFC 3986 & RFC 7230.
 *
 * Examples:
 *   formatTargetHost('::1', 5173) -> '[::1]:5173'
 *   formatTargetHost('[::1]', 5173) -> '[::1]:5173'
 *   formatTargetHost('127.0.0.1', 5173) -> '127.0.0.1:5173'
 *   formatTargetHost('localhost', 5173) -> 'localhost:5173'
 */
export function formatTargetHost(host: string, port?: number): string {
  const clean = cleanHostName(host);
  const formattedHost = clean.includes(':') ? `[${clean}]` : clean;
  return port !== undefined ? `${formattedHost}:${port}` : formattedHost;
}
