/**
 * @devmirror/cli - Terminal Banner & Display Formatter
 * Human-readable terminal output, status panels, and styled banners.
 */

import chalk from 'chalk';
import { CLI_VERSION } from './args.js';

export interface DisplayStatusOptions {
  frameworkName?: string;
  targetUrl: string;
  lanIp: string;
  proxyPort: number;
  controlPort: number;
  mobileUrl: string;
  qrCode: string;
  connectedDevices?: number;
  isFallbackIp?: boolean;
}

export class TerminalDisplay {
  /**
   * Prints the DevMirror ASCII header banner.
   */
  public static printBanner(): void {
    console.log(
      chalk.cyan(`
  ██████╗ ███████╗██╗   ██╗███╗   ███╗██╗██████╗ ██████╗  ██████╗ ██████╗ 
  ██╔══██╗██╔════╝██║   ██║████╗ ████║██║██╔══██╗██╔══██╗██╔═══██╗██╔══██╗
  ██║  ██║█████╗  ██║   ██║██╔████╔██║██║██████╔╝██████╔╝██║   ██║██████╔╝
  ██║  ██║██╔══╝  ╚██╗ ██╔╝██║╚██╔╝██║██║██╔══██╗██╔══██╗██║   ██║██╔══██╗
  ██████╔╝███████╗ ╚████╔╝ ██║ ╚═╝ ██║██║██║  ██║██║  ██║╚██████╔╝██║  ██║
  ╚═════╝ ╚══════╝  ╚═══╝  ╚═╝     ╚═╝╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝ v${CLI_VERSION}
    `)
    );
    console.log(chalk.dim('  Zero-config mobile browser preview with preserved framework HMR\n'));
  }

  /**
   * Prints the active session dashboard, target information, and QR code.
   */
  public static printDashboard(status: DisplayStatusOptions): void {
    console.log(chalk.bold.green('  ✔ DevMirror is running!\n'));

    // Project Info
    const framework = status.frameworkName || 'Web Project';
    console.log(`  ${chalk.bold('Target Project:')}  ${chalk.yellow(framework)} (${chalk.cyan(status.targetUrl)})`);
    console.log(`  ${chalk.bold('LAN Proxy Port:')}  ${chalk.cyan(String(status.proxyPort))}`);
    console.log(`  ${chalk.bold('Control Port:')}    ${chalk.cyan(String(status.controlPort))}`);
    console.log(`  ${chalk.bold('Local Wi-Fi IP:')}  ${chalk.cyan(status.lanIp)}`);

    if (status.isFallbackIp || status.lanIp === '127.0.0.1') {
      console.log(
        chalk.yellow(
          '\n  [!] Warning: Using loopback IP (127.0.0.1). Ensure your mobile device and PC are on the same Wi-Fi network.'
        )
      );
    }

    // QR Code
    console.log(chalk.bold('\n  Scan with your mobile phone camera:\n'));
    // Indent QR code slightly
    const indentedQr = status.qrCode
      .split('\n')
      .map((line) => '    ' + line)
      .join('\n');
    console.log(indentedQr);

    // Fallback URL
    console.log(chalk.dim('  Or manually enter this URL on your phone:'));
    console.log(`  ${chalk.underline.cyan(status.mobileUrl)}\n`);

    // Connected devices & Keyboard hints
    const deviceCount = status.connectedDevices ?? 0;
    const deviceText =
      deviceCount === 0
        ? chalk.dim('0 connected (waiting for first scan...)')
        : chalk.green(`${deviceCount} active connected device(s)`);

    console.log(`  ${chalk.bold('Devices:')}         ${deviceText}`);
    console.log(chalk.dim('  -------------------------------------------------------------'));
    console.log(
      chalk.dim('  [q] Stop & exit   [r] Rescan servers   [h] Help')
    );
    console.log(chalk.dim('  -------------------------------------------------------------\n'));
  }

  /**
   * Prints error banner.
   */
  public static printError(title: string, message: string): void {
    console.error(chalk.red(`\n  ✖ Error: ${title}`));
    console.error(chalk.yellow(`    ${message}\n`));
  }
}
