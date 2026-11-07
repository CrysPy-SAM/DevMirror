/**
 * @devmirror/cli - Main CLI Entry Point
 * Orchestrates CLI invocation, server selection, engine startup, and error handling.
 */

import chalk from 'chalk';
import { parseCliArgs, HELP_TEXT, CLI_VERSION, type CliArgs } from './args.js';
import { TerminalDisplay } from './banner.js';
import { ServerSelector } from './selector.js';
import { DevMirrorCliRunner } from './runner.js';

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  let args: CliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (err: any) {
    TerminalDisplay.printError('Invalid Arguments', err.message);
    console.log(chalk.dim('Run "devmirror --help" for available options.\n'));
    return 1;
  }

  // 1. Version
  if (args.version) {
    console.log(`v${CLI_VERSION}`);
    return 0;
  }

  // 2. Help
  if (args.help) {
    TerminalDisplay.printBanner();
    console.log(HELP_TEXT);
    return 0;
  }

  TerminalDisplay.printBanner();

  // 3. Server Selection
  const selector = new ServerSelector();
  let target;
  try {
    target = await selector.selectTarget({
      manualPort: args.port,
      manualHost: args.host,
      allowInsecureCertificates: args.allowInsecureCertificates
    });
  } catch (err: any) {
    TerminalDisplay.printError('Server Discovery Failed', err.message);
    return 1;
  }

  if (!target) {
    console.log(chalk.dim('\n  DevMirror stopped. No project selected.\n'));
    return 0;
  }

  // 4. Start Runner
  const runner = new DevMirrorCliRunner();

  // Register OS termination signals
  const onSignal = async () => {
    console.log(chalk.yellow('\n\n  Shutting down DevMirror gracefully...'));
    try {
      await runner.stop();
    } catch {
      // ignore
    }
    process.exit(0);
  };

  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    await runner.start({
      target,
      preferredProxyPort: args.preferredProxyPort,
      preferredControlPort: args.preferredControlPort,
      enableOverlay: args.overlay,
      enableKeyboardControls: true
    });
  } catch (err: any) {
    TerminalDisplay.printError('Startup Error', err.message);
    await runner.stop();
    return 1;
  }

  // Keep process active in TTY or wait until stopped
  return 0;
}
