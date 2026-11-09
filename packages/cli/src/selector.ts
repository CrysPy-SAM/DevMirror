/**
 * @devmirror/cli - Server Discovery & Interactive Selector
 * Discovers running development servers and manages user selection.
 */

import readline from 'node:readline';
import chalk from 'chalk';
import ora from 'ora';
import { DevServerScanner, validateServer, type DiscoveredDevServer } from '@devmirror/scanner';
import type { TargetDevServer } from '@devmirror/shared';

export interface SelectTargetOptions {
  manualPort?: number;
  manualHost?: string;
  allowInsecureCertificates?: boolean;
  scanner?: DevServerScanner;
  readlineInterface?: readline.Interface;
  isInteractive?: boolean;
}

/**
 * Prompts user for single line input.
 */
export async function prompt(
  query: string,
  existingRl?: readline.Interface
): Promise<string> {
  const rl =
    existingRl ||
    readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

  const shouldClose = !existingRl;

  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      if (shouldClose) rl.close();
      resolve(answer.trim());
    });
  });
}

export class ServerSelector {
  private readonly scanner: DevServerScanner;
  private readonly isInteractive: boolean;

  constructor(customScanner?: DevServerScanner, isInteractive: boolean = process.stdin.isTTY ?? false) {
    this.scanner = customScanner || new DevServerScanner();
    this.isInteractive = isInteractive;
  }

  /**
   * Discovers and selects the target development server.
   */
  public async selectTarget(options: SelectTargetOptions = {}): Promise<TargetDevServer | null> {
    const host = options.manualHost ?? '127.0.0.1';
    const allowInsecure = options.allowInsecureCertificates ?? false;
    const rl = options.readlineInterface;

    // 1. If manual port is explicitly provided via flag, validate and use it directly
    if (options.manualPort !== undefined) {
      return this.validateAndBuildTarget(host, options.manualPort, allowInsecure, options.manualHost);
    }

    // 2. Discover servers on local host
    const spinner = ora({
      text: chalk.dim('Scanning for running development servers...')
    });

    if (this.isInteractive) {
      spinner.start();
    }

    let servers: DiscoveredDevServer[] = [];
    try {
      servers = await this.scanner.scan({
        host,
        allowInsecureCertificates: allowInsecure,
        timeoutMs: 400
      });
      if (this.isInteractive) {
        spinner.stop();
      }
    } catch (err: any) {
      if (this.isInteractive) {
        spinner.fail(`Scanner error: ${err.message}`);
      }
      servers = [];
    }

    // Case A: No servers discovered
    if (servers.length === 0) {
      console.log(chalk.yellow('\n  [?] No active development servers discovered on common ports.'));

      if (!this.isInteractive) {
        console.log(chalk.dim('  Non-interactive mode: specify --port <port> to preview.'));
        return null;
      }

      console.log(chalk.dim('  Make sure your development server (e.g. Vite, Next.js) is running.\n'));
      const answer = await prompt(chalk.bold('  Enter your dev server port manually (or "q" to quit): '), rl);

      if (!answer || answer.toLowerCase() === 'q') {
        return null;
      }

      const manualPort = Number(answer);
      if (!Number.isInteger(manualPort) || manualPort < 1 || manualPort > 65535) {
        throw new Error(`Invalid port: "${answer}". Must be an integer between 1 and 65535.`);
      }

      return this.validateAndBuildTarget(host, manualPort, allowInsecure);
    }

    // Case B: Exactly 1 server discovered
    if (servers.length === 1) {
      const server = servers[0];
      const procInfo = server.processName ? chalk.dim(` (${server.processName})`) : '';
      const confidence = chalk.dim(`[${server.confidence} confidence]`);

      console.log(
        chalk.green(`\n  ✔ Discovered ${chalk.bold(server.frameworkName)} on ${chalk.cyan(server.url)}${procInfo} ${confidence}\n`)
      );

      if (!this.isInteractive) {
        // In non-interactive mode, single discovered server is accepted
        return {
          host: server.host,
          port: server.port,
          isHttps: server.isHttps,
          framework: server.framework,
          frameworkName: server.frameworkName
        };
      }

      const answer = await prompt(chalk.bold('  Preview this project? (Y/n / enter custom port): '), rl);
      const lower = answer.toLowerCase();

      if (lower === '' || lower === 'y' || lower === 'yes') {
        return {
          host: server.host,
          port: server.port,
          isHttps: server.isHttps,
          framework: server.framework,
          frameworkName: server.frameworkName
        };
      }

      if (lower === 'n' || lower === 'no' || lower === 'q') {
        return null;
      }

      // Check if user entered another port
      const otherPort = Number(answer);
      if (Number.isInteger(otherPort) && otherPort >= 1 && otherPort <= 65535) {
        return this.validateAndBuildTarget(host, otherPort, allowInsecure);
      }

      return null;
    }

    // Case C: Multiple servers discovered - NEVER silently select one!
    console.log(chalk.bold('\n  Multiple running development servers found:'));
    servers.forEach((s, idx) => {
      const num = chalk.cyan(`[${idx + 1}]`);
      const fw = chalk.bold.green(s.frameworkName.padEnd(12));
      const url = chalk.cyan(s.url);
      const proc = s.processName ? chalk.dim(`(PID: ${s.processId ?? '?'}, ${s.processName})`) : '';
      const conf = chalk.dim(`[${s.confidence}]`);
      console.log(`    ${num} ${fw} on ${url} ${proc} ${conf}`);
    });

    const customOptIndex = servers.length + 1;
    console.log(`    ${chalk.cyan(`[${customOptIndex}]`)} ${chalk.dim('Enter another custom port manually')}`);
    console.log(`    ${chalk.dim('[q]   Quit')}\n`);

    if (!this.isInteractive) {
      console.log(chalk.yellow('  Multiple candidates in non-interactive mode. Please specify --port <port>.'));
      return null;
    }

    const answer = await prompt(chalk.bold(`  Select server to preview [1-${servers.length}] (default: 1): `), rl);
    const trimmed = answer.trim();

    if (trimmed.toLowerCase() === 'q') {
      return null;
    }

    // Default to first option
    if (trimmed === '') {
      const selected = servers[0];
      return {
        host: selected.host,
        port: selected.port,
        isHttps: selected.isHttps,
        framework: selected.framework,
        frameworkName: selected.frameworkName
      };
    }

    const selectedIndex = Number(trimmed);
    if (selectedIndex >= 1 && selectedIndex <= servers.length) {
      const selected = servers[selectedIndex - 1];
      return {
        host: selected.host,
        port: selected.port,
        isHttps: selected.isHttps,
        framework: selected.framework,
        frameworkName: selected.frameworkName
      };
    }

    if (selectedIndex === customOptIndex) {
      const customPortStr = await prompt(chalk.bold('  Enter custom port: '), rl);
      const customPort = Number(customPortStr);
      if (!Number.isInteger(customPort) || customPort < 1 || customPort > 65535) {
        throw new Error(`Invalid port: "${customPortStr}". Must be an integer between 1 and 65535.`);
      }
      return this.validateAndBuildTarget(host, customPort, allowInsecure);
    }

    console.log(chalk.red(`  Invalid selection: "${trimmed}".`));
    return null;
  }

  /**
   * Validates a manually specified host and port, performing fingerprinting.
   */
  private async validateAndBuildTarget(
    host: string,
    port: number,
    allowInsecure: boolean,
    explicitHost?: string
  ): Promise<TargetDevServer> {
    const validated = await validateServer(host, port, {
      timeoutMs: 1000,
      allowInsecureCertificates: allowInsecure
    });

    if (validated) {
      return {
        host: explicitHost || validated.host,
        port: validated.port,
        isHttps: validated.isHttps,
        framework: validated.framework,
        frameworkName: validated.frameworkName
      };
    }

    // Even if not actively responding, user explicitly asked for this port
    // (e.g. dev server is compiling or starting up). Warn and return descriptor.
    console.log(chalk.yellow(`  [!] Notice: Port ${port} is not yet responding to HTTP requests.`));
    console.log(chalk.dim(`      DevMirror will attempt to proxy to http://${host}:${port} once it starts.\n`));

    return {
      host,
      port,
      isHttps: false,
      framework: 'generic',
      frameworkName: 'Custom Port'
    };
  }
}
