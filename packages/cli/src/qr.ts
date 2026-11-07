/**
 * @devmirror/cli - QR Code & Mobile URL Generator
 * Formats secure pairing URLs and renders terminal ASCII QR codes.
 */

import qrcodeTerminal from 'qrcode-terminal';

/**
 * Constructs the mobile preview URL with the cryptographically secure session token.
 */
export function buildMobilePreviewUrl(lanIp: string, proxyPort: number, token: string): string {
  // If IPv6 literal, wrap in brackets
  const formattedHost = lanIp.includes(':') ? `[${lanIp}]` : lanIp;
  return `http://${formattedHost}:${proxyPort}/?dm_token=${token}`;
}

/**
 * Generates an ASCII terminal QR code for a given URL.
 */
export async function generateTerminalQr(url: string, small: boolean = true): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      qrcodeTerminal.generate(url, { small }, (code: string) => {
        if (!code || typeof code !== 'string') {
          reject(new Error('Failed to generate terminal QR code.'));
        } else {
          resolve(code);
        }
      });
    } catch (err) {
      reject(new Error(`QR Code Generation Error: ${(err as Error).message}`));
    }
  });
}
