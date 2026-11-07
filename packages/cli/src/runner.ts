/**
 * @devmirror/cli - Engine Runner & Session Lifecycle Manager
 * Coordinates DevMirrorEngine lifecycle, QR code generation, keyboard interaction, and clean shutdown.
 */

import readline from 'node:readline';
import chalk from 'chalk';
import { DevMirrorEngine, type DevMirrorEngineOptions } from '@devmirror/core';
import type { TargetDevServer } from '@devmirror/shared';
import { buildMobilePreviewUrl, generateTerminalQr } from './qr.js';
import { TerminalDisplay } from './banner.js';

export interface CliRunnerOptions {
  target: TargetDevServer;
  preferredProxyPort?: number;
  preferredControlPort?: number;
  enableOverlay?: boolean;
  enableKeyboardControls?: boolean;
}

export class DevMirrorCliRunner {
  private engine: DevMirrorEngine | null = null;
  private isRunning: boolean = false;
  private isShuttingDown: boolean = false;
  private keypressHandler: ((str: string, key: any) => void) | null = null;
  private devicePollTimer: NodeJS.Timeout | null = null;
  private lastConnectedCount: number = 0;

  /**
   * Starts the core engine with the selected target, displays the QR code and dashboard.
   */
  public async start(options: CliRunnerOptions): Promise<{
    previewUrl: string;
    proxyPort: number;
    controlPort: number;
    lanIp: string;
    qrCode: string;
  }> {
    if (this.isRunning) {
      throw new Error('DevMirror CLI Runner is already running');
    }

    const engineOptions: DevMirrorEngineOptions = {
      preferredProxyPort: options.preferredProxyPort,
      preferredControlPort: options.preferredControlPort,
      target: options.target,
      enableOverlay: options.enableOverlay ?? false,
      enableGracefulShutdown: false // Managed by runner directly
    };

    this.engine = new DevMirrorEngine(engineOptions);

    let startResult;
    try {
      startResult = await this.engine.start();
    } catch (err: any) {
      TerminalDisplay.printError('Core Engine Startup Failed', err.message);
      await this.stop();
      throw err;
    }

    const { session, proxyPort, controlPort, lanIp } = startResult;

    if (!session || !session.token) {
      await this.stop();
      throw new Error('Failed to create secure session token.');
    }

    const mobileUrl = buildMobilePreviewUrl(lanIp, proxyPort, session.token);

    let qrCode = '';
    try {
      qrCode = await generateTerminalQr(mobileUrl, true);
    } catch (err: any) {
      console.warn(chalk.yellow(`\n  [!] Notice: Terminal QR code could not be rendered: ${err.message}`));
      qrCode = '[QR Code Unavailable]';
    }

    const targetUrl = `http${options.target.isHttps ? 's' : ''}://${options.target.host}:${options.target.port}`;

    TerminalDisplay.printDashboard({
      frameworkName: options.target.frameworkName || options.target.framework,
      targetUrl,
      lanIp,
      proxyPort,
      controlPort,
      mobileUrl,
      qrCode,
      connectedDevices: 0,
      isFallbackIp: lanIp === '127.0.0.1'
    });

    this.isRunning = true;

    // Monitor connected devices
    this.startDeviceMonitor();

    // Enable keyboard interaction if requested and TTY is active
    if (options.enableKeyboardControls !== false && process.stdin.isTTY) {
      this.setupKeyboardShortcuts();
    }

    return {
      previewUrl: mobileUrl,
      proxyPort,
      controlPort,
      lanIp,
      qrCode
    };
  }

  /**
   * Periodically monitors connected devices to provide real-time updates.
   */
  private startDeviceMonitor(): void {
    if (this.devicePollTimer) clearInterval(this.devicePollTimer);

    this.devicePollTimer = setInterval(() => {
      if (!this.engine || !this.isRunning) return;

      try {
        const devices = this.engine.session.getConnectedDevices();
        const currentCount = devices.length;

        if (currentCount !== this.lastConnectedCount) {
          if (currentCount > this.lastConnectedCount) {
            console.log(
              chalk.green(
                `\n  ✔ New mobile device paired! Total active: ${currentCount}`
              )
            );
          } else {
            console.log(
              chalk.dim(
                `\n  ℹ Device disconnected. Total active: ${currentCount}`
              )
            );
          }
          this.lastConnectedCount = currentCount;
        }
      } catch {
        // Safe ignore
      }
    }, 2000);
  }

  /**
   * Sets up interactive keyboard shortcuts: q (quit), r (rescan/reload), h (help).
   */
  private setupKeyboardShortcuts(): void {
    try {
      readline.emitKeypressEvents(process.stdin);
      if (process.stdin.isTTY && process.stdin.setRawMode) {
        process.stdin.setRawMode(true);
      }

      this.keypressHandler = async (_str: string, key: any) => {
        if (!key) return;

        // Quit: 'q' or Ctrl+C
        if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
          console.log(chalk.yellow('\n  Stopping DevMirror and releasing ports...'));
          await this.stop();
          process.exit(0);
        }

        // Help: 'h'
        if (key.name === 'h') {
          console.log(chalk.cyan('\n  Keyboard shortcuts:'));
          console.log(chalk.dim('    q - Stop DevMirror and exit cleanly'));
          console.log(chalk.dim('    r - Check session and network status'));
          console.log(chalk.dim('    h - Show this help menu\n'));
        }

        // Status refresh: 'r'
        if (key.name === 'r') {
          if (this.engine) {
            const devCount = this.engine.session.getConnectedDevices().length;
            console.log(chalk.cyan(`\n  [Status] LAN Proxy: :${this.engine.proxyPort} | Control: :${this.engine.controlPort} | Connected: ${devCount} device(s)`));
          }
        }
      };

      process.stdin.on('keypress', this.keypressHandler);
    } catch {
      // In non-standard environments, keypress listener can fail gracefully
    }
  }

  /**
   * Tears down keyboard listener, cleans up raw mode.
   */
  private teardownKeyboard(): void {
    if (this.keypressHandler) {
      process.stdin.removeListener('keypress', this.keypressHandler);
      this.keypressHandler = null;
    }
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Stops the engine, releases ports, and resets state.
   */
  public async stop(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    if (this.devicePollTimer) {
      clearInterval(this.devicePollTimer);
      this.devicePollTimer = null;
    }

    this.teardownKeyboard();

    if (this.engine) {
      try {
        await this.engine.stop();
      } catch (err: any) {
        console.error(chalk.red(`  Error stopping engine: ${err.message}`));
      }
      this.engine = null;
    }

    this.isRunning = false;
    this.isShuttingDown = false;
  }

  public get running(): boolean {
    return this.isRunning;
  }

  public get activeEngine(): DevMirrorEngine | null {
    return this.engine;
  }
}
