import { describe, it, expect } from 'vitest';
import { ProcessInspector } from '../src/process/inspector.js';
import { WindowsProcessInspector } from '../src/process/windows.js';
import type { IProcessInspector } from '../src/process/types.js';

describe('ProcessInspector', () => {
  it('should delegate to a custom inspector if provided', async () => {
    const mockInspector: IProcessInspector = {
      findProcessByPort: async (port: number) => {
        if (port === 3000) {
          return { pid: 1234, processName: 'node.exe' };
        }
        return null;
      }
    };

    const inspector = new ProcessInspector(mockInspector);
    const result = await inspector.findProcessByPort(3000);
    expect(result).toEqual({ pid: 1234, processName: 'node.exe' });

    const notFound = await inspector.findProcessByPort(8080);
    expect(notFound).toBeNull();
  });

  it('should return null when delegate throws an error', async () => {
    const errorInspector: IProcessInspector = {
      findProcessByPort: async () => {
        throw new Error('Permission denied');
      }
    };

    const inspector = new ProcessInspector(errorInspector);
    const result = await inspector.findProcessByPort(3000);
    expect(result).toBeNull();
  });

  it('should safely return null for unused/non-existent ports on Windows', async () => {
    const winInspector = new WindowsProcessInspector(500);
    const result = await winInspector.findProcessByPort(65432);
    expect(result).toBeNull();
  });

  describe('Windows Process Parsing (IPv4, IPv6, and Argument Security)', () => {
    it('should parse IPv4 listening lines correctly', () => {
      const netstatOutput = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1120
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4120
  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       14208
      `;

      expect(WindowsProcessInspector.parseNetstatPid(netstatOutput, 3000)).toBe(4120);
      expect(WindowsProcessInspector.parseNetstatPid(netstatOutput, 5173)).toBe(14208);
      expect(WindowsProcessInspector.parseNetstatPid(netstatOutput, 8080)).toBeNull();
    });

    it('should parse IPv6 listening lines correctly', () => {
      const netstatOutput = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    [::]:3000              [::]:0                 LISTENING       8824
  TCP    [::1]:4200             [::]:0                 LISTENING       9912
  TCP    [fe80::1%12]:8080      [::]:0                 LISTENING       5566
      `;

      expect(WindowsProcessInspector.parseNetstatPid(netstatOutput, 3000)).toBe(8824);
      expect(WindowsProcessInspector.parseNetstatPid(netstatOutput, 4200)).toBe(9912);
      expect(WindowsProcessInspector.parseNetstatPid(netstatOutput, 8080)).toBe(5566);
    });

    it('should not match foreign address ports or non-listening connections', () => {
      const netstatOutput = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    192.168.1.5:54321      93.184.216.34:3000     ESTABLISHED     1234
  TCP    127.0.0.1:45300        0.0.0.0:0              LISTENING       6677
      `;

      // 3000 is foreign address, not local listening -> must return null
      expect(WindowsProcessInspector.parseNetstatPid(netstatOutput, 3000)).toBeNull();

      // 300 is a substring of 45300 -> must return null
      expect(WindowsProcessInspector.parseNetstatPid(netstatOutput, 300)).toBeNull();
    });

    it('should reject invalid ports in parseNetstatPid', () => {
      expect(WindowsProcessInspector.parseNetstatPid('TCP 0.0.0.0:80 0.0.0.0:0 LISTENING 100', 0)).toBeNull();
      expect(WindowsProcessInspector.parseNetstatPid('TCP 0.0.0.0:80 0.0.0.0:0 LISTENING 100', 70000)).toBeNull();
      expect(WindowsProcessInspector.parseNetstatPid('TCP 0.0.0.0:80 0.0.0.0:0 LISTENING 100', -1)).toBeNull();
    });

    it('should parse tasklist CSV output safely', () => {
      const csvOutput = `"node.exe","14208","Console","1","45,200 K"`;
      expect(WindowsProcessInspector.parseTasklistName(csvOutput)).toBe('node.exe');

      const bunOutput = `"bun.exe","4120","Console","1","32,000 K"`;
      expect(WindowsProcessInspector.parseTasklistName(bunOutput)).toBe('bun.exe');

      const noTaskOutput = `INFO: No tasks are running which match the specified criteria.`;
      expect(WindowsProcessInspector.parseTasklistName(noTaskOutput)).toBeNull();
    });

    it('should reject invalid PIDs before executing system commands', async () => {
      const winInspector = new WindowsProcessInspector();
      expect(await winInspector.findProcessNameByPid(0)).toBeNull();
      expect(await winInspector.findProcessNameByPid(-10)).toBeNull();
      expect(await winInspector.findProcessNameByPid(5000000)).toBeNull();
    });
  });
});
