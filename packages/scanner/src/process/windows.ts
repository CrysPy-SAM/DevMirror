/**
 * @devmirror/scanner - Windows Process Inspector
 * Uses read-only Windows native utilities (netstat and tasklist) to resolve PIDs and process names.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { IProcessInspector, ProcessInfo } from './types.js';

const execFileAsync = promisify(execFile);

export class WindowsProcessInspector implements IProcessInspector {
  private readonly timeoutMs: number;

  constructor(timeoutMs: number = 1000) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Resolves the PID listening on a given port using netstat -ano -p tcp.
   */
  public async findPidByPort(port: number): Promise<number | null> {
    try {
      const { stdout } = await execFileAsync('netstat.exe', ['-ano', '-p', 'tcp'], {
        timeout: this.timeoutMs,
        windowsHide: true
      });

      // Find lines matching: TCP  (IP):(PORT)  (ANY)  LISTENING  (PID)
      const regex = new RegExp(`:${port}\\s+[^\\s]+\\s+LISTENING\\s+(\\d+)`, 'i');
      const match = stdout.match(regex);

      if (match && match[1]) {
        const pid = parseInt(match[1], 10);
        return isNaN(pid) ? null : pid;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Resolves the process executable name for a given PID using tasklist.
   */
  public async findProcessNameByPid(pid: number): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(
        'tasklist.exe',
        ['/fi', `PID eq ${pid}`, '/fo', 'csv', '/nh'],
        {
          timeout: this.timeoutMs,
          windowsHide: true
        }
      );

      // Example CSV output: "node.exe","14208","Console","1","45,200 K"
      const match = stdout.match(/"([^"]+)"/);
      if (match && match[1] && !match[1].toLowerCase().includes('no tasks')) {
        return match[1];
      }

      return null;
    } catch {
      return null;
    }
  }

  public async findProcessByPort(port: number): Promise<ProcessInfo | null> {
    const pid = await this.findPidByPort(port);
    if (!pid) return null;

    const processName = (await this.findProcessNameByPid(pid)) || 'unknown';
    return { pid, processName };
  }
}
