import { describe, it, expect } from 'vitest';
import { runCli } from '../src/cli.js';

describe('runCli Entry Point', () => {
  it('should return 0 for --version', async () => {
    const exitCode = await runCli(['--version']);
    expect(exitCode).toBe(0);
  });

  it('should return 0 for --help', async () => {
    const exitCode = await runCli(['--help']);
    expect(exitCode).toBe(0);
  });

  it('should return 1 for invalid argument flags', async () => {
    const exitCode = await runCli(['--non-existent-flag']);
    expect(exitCode).toBe(1);
  });

  it('should return 1 for invalid port bounds', async () => {
    const exitCode = await runCli(['--port', '70000']);
    expect(exitCode).toBe(1);
  });
});
