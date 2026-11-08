import { describe, it, expect } from 'vitest';
import { PosixProcessInspector } from '../src/process/posix.js';

describe('PosixProcessInspector', () => {
  describe('Port & PID Validation', () => {
    it('should validate TCP port ranges correctly', () => {
      expect(PosixProcessInspector.isValidPort(80)).toBe(true);
      expect(PosixProcessInspector.isValidPort(3000)).toBe(true);
      expect(PosixProcessInspector.isValidPort(5173)).toBe(true);
      expect(PosixProcessInspector.isValidPort(65535)).toBe(true);

      expect(PosixProcessInspector.isValidPort(0)).toBe(false);
      expect(PosixProcessInspector.isValidPort(-1)).toBe(false);
      expect(PosixProcessInspector.isValidPort(65536)).toBe(false);
      expect(PosixProcessInspector.isValidPort(3000.5)).toBe(false);
      expect(PosixProcessInspector.isValidPort(NaN)).toBe(false);
      expect(PosixProcessInspector.isValidPort(Infinity)).toBe(false);
    });

    it('should validate POSIX PID ranges correctly', () => {
      expect(PosixProcessInspector.isValidPid(1)).toBe(true);
      expect(PosixProcessInspector.isValidPid(500)).toBe(true);
      expect(PosixProcessInspector.isValidPid(14208)).toBe(true);
      expect(PosixProcessInspector.isValidPid(4194304)).toBe(true);

      expect(PosixProcessInspector.isValidPid(0)).toBe(false);
      expect(PosixProcessInspector.isValidPid(-10)).toBe(false);
      expect(PosixProcessInspector.isValidPid(5000000)).toBe(false);
      expect(PosixProcessInspector.isValidPid(12.34)).toBe(false);
      expect(PosixProcessInspector.isValidPid(NaN)).toBe(false);
    });
  });

  describe('lsof Parsing', () => {
    it('should parse machine-readable lsof -F pc output correctly', () => {
      const output = 'p14208\ncnode\n';
      const result = PosixProcessInspector.parseLsofFieldOutput(output);
      expect(result).toEqual({ pid: 14208, processName: 'node' });
    });

    it('should handle lsof -F output with Windows and POSIX line breaks', () => {
      const output = 'p4512\r\ncvite\r\n';
      const result = PosixProcessInspector.parseLsofFieldOutput(output);
      expect(result).toEqual({ pid: 4512, processName: 'vite' });
    });

    it('should return fallback name "unknown" when process name field is missing', () => {
      const output = 'p9912\n';
      const result = PosixProcessInspector.parseLsofFieldOutput(output);
      expect(result).toEqual({ pid: 9912, processName: 'unknown' });
    });

    it('should reject invalid or out-of-bounds PIDs in field output', () => {
      expect(PosixProcessInspector.parseLsofFieldOutput('p-10\ncnode\n')).toBeNull();
      expect(PosixProcessInspector.parseLsofFieldOutput('p99999999\ncnode\n')).toBeNull();
      expect(PosixProcessInspector.parseLsofFieldOutput('pABC\ncnode\n')).toBeNull();
      expect(PosixProcessInspector.parseLsofFieldOutput('')).toBeNull();
    });

    it('should parse standard tabular lsof output as a fallback', () => {
      const tabular = `
COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node    14208 user   22u  IPv4 0xdeadbeef      0t0  TCP *:3000 (LISTEN)
      `;
      const result = PosixProcessInspector.parseLsofTabularOutput(tabular, 3000);
      expect(result).toEqual({ pid: 14208, processName: 'node' });
    });

    it('should parse tabular lsof IPv6 lines and ignore unrelated ports', () => {
      const tabular = `
COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
next-se  8812 user   12u  IPv6 0xbeefcafe      0t0  TCP [::1]:5173 (LISTEN)
node     4421 user   15u  IPv4 0x12345678      0t0  TCP *:8080 (LISTEN)
      `;
      expect(PosixProcessInspector.parseLsofTabularOutput(tabular, 5173)).toEqual({
        pid: 8812,
        processName: 'next-se'
      });
      expect(PosixProcessInspector.parseLsofTabularOutput(tabular, 4000)).toBeNull();
    });

    it('should ignore non-listening lsof connections', () => {
      const tabular = `
COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
curl    9911 user   3u   IPv4 0x11111111      0t0  TCP 192.168.1.10:54321->93.184.216.34:3000 (ESTABLISHED)
      `;
      expect(PosixProcessInspector.parseLsofTabularOutput(tabular, 3000)).toBeNull();
    });
  });

  describe('Linux ss Parsing', () => {
    it('should parse Linux ss -tlpn lines with embedded process information', () => {
      const ssOutput = `
LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=14208,fd=19))
LISTEN 0 511 0.0.0.0:8080 0.0.0.0:* users:(("nginx",pid=1001,fd=6))
      `;
      const result = PosixProcessInspector.parseSsOutput(ssOutput, 3000);
      expect(result).toEqual({ pid: 14208, processName: 'node' });
    });

    it('should parse ss IPv6 lines correctly', () => {
      const ssOutput = `
LISTEN 0 511 [::]:5173 [::]:* users:(("vite",pid=8921,fd=14))
      `;
      const result = PosixProcessInspector.parseSsOutput(ssOutput, 5173);
      expect(result).toEqual({ pid: 8921, processName: 'vite' });
    });

    it('should extract PID when process name is omitted in ss output', () => {
      const ssOutput = `
LISTEN 0 511 0.0.0.0:4200 0.0.0.0:* pid=7711
      `;
      const result = PosixProcessInspector.parseSsOutput(ssOutput, 4200);
      expect(result).toEqual({ pid: 7711, processName: 'unknown' });
    });

    it('should return null when port is not present in ss output', () => {
      const ssOutput = `
LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=14208,fd=19))
      `;
      expect(PosixProcessInspector.parseSsOutput(ssOutput, 8080)).toBeNull();
    });
  });

  describe('ps comm Parsing', () => {
    it('should extract base command name from ps output', () => {
      expect(PosixProcessInspector.parsePsComm('node\n')).toBe('node');
      expect(PosixProcessInspector.parsePsComm('/usr/local/bin/node\n')).toBe('node');
      expect(PosixProcessInspector.parsePsComm('/opt/homebrew/bin/bun')).toBe('bun');
      expect(PosixProcessInspector.parsePsComm('')).toBeNull();
      expect(PosixProcessInspector.parsePsComm('   \n')).toBeNull();
    });
  });

  describe('Command Execution & Fallback Flow', () => {
    it('should successfully inspect process via lsof when available', async () => {
      const executedCommands: Array<{ file: string; args: string[] }> = [];

      const mockExecutor = async (file: string, args: string[]) => {
        executedCommands.push({ file, args });
        if (file === 'lsof') {
          return { stdout: 'p12345\ncnode\n', stderr: '' };
        }
        throw new Error('Unexpected binary');
      };

      const inspector = new PosixProcessInspector(500, mockExecutor);
      const result = await inspector.findProcessByPort(3000);

      expect(result).toEqual({ pid: 12345, processName: 'node' });
      expect(executedCommands).toHaveLength(1);
      expect(executedCommands[0].file).toBe('lsof');
      expect(executedCommands[0].args).toEqual([
        '-n',
        '-P',
        '-iTCP:3000',
        '-sTCP:LISTEN',
        '-F',
        'pc'
      ]);
    });

    it('should gracefully fallback to ss when lsof is missing (ENOENT)', async () => {
      const executedCommands: Array<{ file: string; args: string[] }> = [];

      const mockExecutor = async (file: string, args: string[]) => {
        executedCommands.push({ file, args });
        if (file === 'lsof') {
          const err: any = new Error('spawn lsof ENOENT');
          err.code = 'ENOENT';
          throw err;
        }
        if (file === 'ss') {
          return {
            stdout: 'LISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:(("vite",pid=4321,fd=8))\n',
            stderr: ''
          };
        }
        throw new Error('Unexpected binary');
      };

      const inspector = new PosixProcessInspector(500, mockExecutor);
      const result = await inspector.findProcessByPort(5173);

      expect(result).toEqual({ pid: 4321, processName: 'vite' });
      expect(executedCommands).toHaveLength(2);
      expect(executedCommands[0].file).toBe('lsof');
      expect(executedCommands[1].file).toBe('ss');
    });

    it('should resolve process name via ps when ss returns PID without name', async () => {
      const mockExecutor = async (file: string, args: string[]) => {
        if (file === 'lsof') {
          throw new Error('lsof failed');
        }
        if (file === 'ss') {
          return {
            stdout: 'LISTEN 0 511 127.0.0.1:4200 0.0.0.0:* pid=6789\n',
            stderr: ''
          };
        }
        if (file === 'ps') {
          expect(args).toEqual(['-p', '6789', '-o', 'comm=']);
          return { stdout: '/usr/bin/ng\n', stderr: '' };
        }
        throw new Error('Unexpected command');
      };

      const inspector = new PosixProcessInspector(500, mockExecutor);
      const result = await inspector.findProcessByPort(4200);

      expect(result).toEqual({ pid: 6789, processName: 'ng' });
    });

    it('should return null when all inspection commands fail or are missing', async () => {
      const mockExecutor = async () => {
        throw new Error('Command failed');
      };

      const inspector = new PosixProcessInspector(500, mockExecutor);
      const result = await inspector.findProcessByPort(3000);
      expect(result).toBeNull();
    });

    it('should return null immediately for invalid port without executing commands', async () => {
      let commandExecuted = false;
      const mockExecutor = async () => {
        commandExecuted = true;
        return { stdout: '', stderr: '' };
      };

      const inspector = new PosixProcessInspector(500, mockExecutor);
      expect(await inspector.findProcessByPort(0)).toBeNull();
      expect(await inspector.findProcessByPort(-1)).toBeNull();
      expect(await inspector.findProcessByPort(70000)).toBeNull();
      expect(commandExecuted).toBe(false);
    });

    it('should handle execution timeouts safely without throwing', async () => {
      const mockExecutor = async () => {
        const timeoutErr: any = new Error('Command timed out');
        timeoutErr.code = 'ETIMEDOUT';
        throw timeoutErr;
      };

      const inspector = new PosixProcessInspector(100, mockExecutor);
      const result = await inspector.findProcessByPort(3000);
      expect(result).toBeNull();
    });
  });
});
