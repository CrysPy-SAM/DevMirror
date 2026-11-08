/**
 * @devmirror/scanner - POSIX Process Inspector (macOS & Linux)
 * Uses native read-only POSIX utilities (lsof, ss, ps) to identify listening PIDs and process names.
 * Strict argument arrays, strict execution timeouts, zero shell execution, and graceful fallback.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { IProcessInspector, ProcessInfo } from './types.js';

const execFileAsync = promisify(execFile);

export type CommandExecutor = (
  file: string,
  args: string[],
  options: { timeout: number; windowsHide: boolean }
) => Promise<{ stdout: string; stderr: string }>;

export class PosixProcessInspector implements IProcessInspector {
  private readonly timeoutMs: number;
  private readonly executor: CommandExecutor;

  constructor(timeoutMs: number = 1000, executor?: CommandExecutor) {
    this.timeoutMs = timeoutMs;
    this.executor = executor ?? (execFileAsync as unknown as CommandExecutor);
  }

  /**
   * Validates that a port is a valid TCP port integer between 1 and 65535.
   */
  public static isValidPort(port: number): boolean {
    return Number.isInteger(port) && port >= 1 && port <= 65535;
  }

  /**
   * Validates that a PID is a valid positive integer within the OS PID limit.
   */
  public static isValidPid(pid: number): boolean {
    // POSIX pid_t maximum is commonly 4,194,304 (e.g. Linux /proc/sys/kernel/pid_max) or 99,999 on macOS
    return Number.isInteger(pid) && pid > 0 && pid <= 4194304;
  }

  /**
   * Parses machine-readable lsof -F pc output:
   * Example:
   *   p14208\n
   *   cnode\n
   */
  public static parseLsofFieldOutput(stdout: string): ProcessInfo | null {
    if (!stdout || typeof stdout !== 'string') return null;

    let pid: number | null = null;
    let processName: string | null = null;

    const lines = stdout.split(/\r?\n/);
    for (const line of lines) {
      if (line.startsWith('p')) {
        const candidate = parseInt(line.slice(1).trim(), 10);
        if (PosixProcessInspector.isValidPid(candidate)) {
          pid = candidate;
        }
      } else if (line.startsWith('c') && line.length > 1) {
        processName = line.slice(1).trim();
      }

      if (pid !== null && processName !== null) {
        break;
      }
    }

    if (pid !== null) {
      return {
        pid,
        processName: processName || 'unknown'
      };
    }

    return null;
  }

  /**
   * Parses standard tabular lsof output as a fallback:
   * Example:
   *   COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
   *   node    14208 user   22u  IPv4 0x...      0t0  TCP *:3000 (LISTEN)
   */
  public static parseLsofTabularOutput(stdout: string, port: number): ProcessInfo | null {
    if (!stdout || !PosixProcessInspector.isValidPort(port)) return null;

    const lines = stdout.split(/\r?\n/);
    for (const line of lines) {
      if (!line.includes('LISTEN')) continue;

      // Ensure the line contains the listening port
      const portRegex = new RegExp(`[:.]${port}\\b`);
      if (!portRegex.test(line)) continue;

      // Extract COMMAND and PID columns
      const match = line.trim().match(/^(\S+)\s+(\d+)/);
      if (match && match[1] && match[2]) {
        const pid = parseInt(match[2], 10);
        if (PosixProcessInspector.isValidPid(pid)) {
          return {
            pid,
            processName: match[1]
          };
        }
      }
    }

    return null;
  }

  /**
   * Parses Linux ss -tlpn output:
   * Example:
   *   LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=14208,fd=19))
   *   LISTEN 0 511 [::]:5173 [::]:* users:(("vite",pid=8921,fd=14))
   */
  public static parseSsOutput(stdout: string, port: number): ProcessInfo | null {
    if (!stdout || !PosixProcessInspector.isValidPort(port)) return null;

    const lines = stdout.split(/\r?\n/);
    for (const line of lines) {
      // Must contain :<port> followed by space or bound
      const portRegex = new RegExp(`[:.]${port}\\s+`);
      if (!portRegex.test(line)) continue;

      // Match users:(("name",pid=123,fd=...))
      const match = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
      if (match && match[1] && match[2]) {
        const pid = parseInt(match[2], 10);
        if (PosixProcessInspector.isValidPid(pid)) {
          return {
            pid,
            processName: match[1]
          };
        }
      }

      // Fallback matching pid=(\d+) if process name is omitted
      const pidOnlyMatch = line.match(/pid=(\d+)/);
      if (pidOnlyMatch && pidOnlyMatch[1]) {
        const pid = parseInt(pidOnlyMatch[1], 10);
        if (PosixProcessInspector.isValidPid(pid)) {
          return {
            pid,
            processName: 'unknown'
          };
        }
      }
    }

    return null;
  }

  /**
   * Resolves process name from PID using ps -p <pid> -o comm=
   */
  public static parsePsComm(stdout: string): string | null {
    if (!stdout) return null;
    const trimmed = stdout.trim();
    if (!trimmed) return null;

    // Return the base command name
    return path.basename(trimmed);
  }

  /**
   * Primary inspection strategy: lsof -n -P -iTCP:<port> -sTCP:LISTEN -F pc
   */
  private async inspectWithLsof(port: number): Promise<ProcessInfo | null> {
    try {
      const { stdout } = await this.executor(
        'lsof',
        ['-n', '-P', `-iTCP:${port}`, '-sTCP:LISTEN', '-F', 'pc'],
        {
          timeout: this.timeoutMs,
          windowsHide: true
        }
      );

      const fieldResult = PosixProcessInspector.parseLsofFieldOutput(stdout);
      if (fieldResult) return fieldResult;

      return PosixProcessInspector.parseLsofTabularOutput(stdout, port);
    } catch {
      return null;
    }
  }

  /**
   * Secondary inspection strategy (Linux): ss -tlpn
   */
  private async inspectWithSs(port: number): Promise<ProcessInfo | null> {
    try {
      const { stdout } = await this.executor('ss', ['-tlpn', '-H'], {
        timeout: this.timeoutMs,
        windowsHide: true
      });

      const result = PosixProcessInspector.parseSsOutput(stdout, port);
      if (result && result.processName === 'unknown') {
        const resolvedName = await this.resolveProcessName(result.pid);
        if (resolvedName) {
          result.processName = resolvedName;
        }
      }

      return result;
    } catch {
      return null;
    }
  }

  /**
   * Resolves command name for a PID using ps
   */
  public async resolveProcessName(pid: number): Promise<string | null> {
    if (!PosixProcessInspector.isValidPid(pid)) return null;

    try {
      const { stdout } = await this.executor(
        'ps',
        ['-p', String(pid), '-o', 'comm='],
        {
          timeout: this.timeoutMs,
          windowsHide: true
        }
      );

      return PosixProcessInspector.parsePsComm(stdout);
    } catch {
      return null;
    }
  }

  /**
   * Dispatches process inspection across available POSIX tools.
   * Never throws; returns null on error, missing binaries, or nonexistent processes.
   */
  public async findProcessByPort(port: number): Promise<ProcessInfo | null> {
    if (!PosixProcessInspector.isValidPort(port)) {
      return null;
    }

    // 1. Try lsof (standard on macOS and most Linux distributions)
    const lsofResult = await this.inspectWithLsof(port);
    if (lsofResult) {
      return lsofResult;
    }

    // 2. Fallback to ss (standard on minimal / iproute2 Linux environments)
    const ssResult = await this.inspectWithSs(port);
    if (ssResult) {
      return ssResult;
    }

    return null;
  }
}
