/**
 * @devmirror/cli - Command Line Arguments Parser
 * Zero-dependency robust argument parsing using Node.js util.parseArgs.
 */

import { parseArgs } from 'node:util';

export const CLI_VERSION = '0.1.0';

export interface CliArgs {
  port?: number;
  host?: string;
  help?: boolean;
  version?: boolean;
  overlay?: boolean;
  allowInsecureCertificates?: boolean;
  preferredProxyPort?: number;
  preferredControlPort?: number;
  tunnel?: boolean;
  password?: string;
}

export const HELP_TEXT = `
DevMirror - Instant Mobile Preview for Local Web Development

USAGE:
  $ npx devmirror-cli [options]
  $ devmirror [options]

OPTIONS:
  -p, --port <port>                 Manually specify target development server port
  -H, --host <host>                 Target dev server host interface (default: 127.0.0.1)
  -t, --tunnel                      Enable Cloudflare Quick Tunnel for public preview
  --password <password>             Custom password for public preview (default: auto-generated)
  --overlay                         Enable companion mobile overlay banner (default: false)
  -k, --insecure                    Allow self-signed HTTPS certificates on dev server
  --proxy-port <port>               Preferred LAN reverse proxy port (default: 4000)
  --control-port <port>             Preferred Control API port (default: 4100)
  -h, --help                        Show this help message
  -v, --version                     Show DevMirror CLI version

EXAMPLES:
  $ devmirror                       Auto-discover and select running dev server
  $ devmirror --tunnel              Preview on LAN and generate public HTTPS tunnel
  $ devmirror --port 5173           Directly preview Vite running on port 5173
  $ devmirror -p 3000 -H localhost  Preview Next.js on localhost:3000
  $ devmirror --port 4200 --overlay Preview Angular with mobile HUD enabled

KEYBOARD CONTROLS:
  q                                 Quit DevMirror and release ports
  r                                 Refresh / rescan local dev servers
  h                                 Show help banner
`;

/**
 * Validates that a string is a valid TCP port number (1 - 65535).
 */
function parsePortOption(val: string | undefined, flagName: string): number | undefined {
  if (val === undefined) return undefined;
  const num = Number(val);
  if (!Number.isInteger(num) || num < 1 || num > 65535) {
    throw new Error(`Invalid ${flagName}: "${val}". Port must be an integer between 1 and 65535.`);
  }
  return num;
}

/**
 * Parses raw command line arguments array.
 */
export function parseCliArgs(args: string[] = process.argv.slice(2)): CliArgs {
  try {
    const { values } = parseArgs({
      args,
      options: {
        port: { type: 'string', short: 'p' },
        host: { type: 'string', short: 'H' },
        overlay: { type: 'boolean', default: false },
        insecure: { type: 'boolean', short: 'k', default: false },
        'allow-insecure-certs': { type: 'boolean', default: false },
        'proxy-port': { type: 'string' },
        'control-port': { type: 'string' },
        tunnel: { type: 'boolean', short: 't', default: false },
        'no-tunnel': { type: 'boolean', default: false },
        password: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false }
      },
      allowPositionals: false,
      strict: true
    });

    const isTunnelEnabled = values['no-tunnel'] ? false : (values.tunnel ?? false);

    return {
      port: parsePortOption(values.port, '--port'),
      host: values.host,
      overlay: values.overlay,
      allowInsecureCertificates: values.insecure || values['allow-insecure-certs'] || false,
      preferredProxyPort: parsePortOption(values['proxy-port'], '--proxy-port'),
      preferredControlPort: parsePortOption(values['control-port'], '--control-port'),
      tunnel: isTunnelEnabled,
      password: values.password,
      help: values.help,
      version: values.version
    };
  } catch (err: any) {
    throw new Error(`CLI Argument Error: ${err.message}`);
  }
}
