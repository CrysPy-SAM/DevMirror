import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import readline from 'node:readline';
import { ServerSelector } from '../src/selector.js';
import type { DevServerScanner, DiscoveredDevServer } from '@devmirror/scanner';

function createMockReadline(inputs: string[]): readline.Interface {
  const input = new Readable({
    read() {
      if (inputs.length > 0) {
        this.push(inputs.shift() + '\n');
      } else {
        this.push(null);
      }
    }
  });
  return readline.createInterface({ input });
}

describe('ServerSelector', () => {
  const serverVite: DiscoveredDevServer = {
    host: '127.0.0.1',
    port: 5173,
    url: 'http://127.0.0.1:5173',
    framework: 'vite',
    frameworkName: 'Vite',
    processId: 1001,
    processName: 'node.exe',
    status: 'online',
    confidence: 'high',
    isHttps: false
  };

  const serverNext: DiscoveredDevServer = {
    host: '127.0.0.1',
    port: 3000,
    url: 'http://127.0.0.1:3000',
    framework: 'nextjs',
    frameworkName: 'Next.js',
    processId: 1002,
    processName: 'node.exe',
    status: 'online',
    confidence: 'high',
    isHttps: false
  };

  it('should use manual port option directly when provided', async () => {
    const selector = new ServerSelector(undefined, false);
    const target = await selector.selectTarget({ manualPort: 5173, manualHost: '127.0.0.1' });

    expect(target).not.toBeNull();
    expect(target?.port).toBe(5173);
    expect(target?.host).toBe('127.0.0.1');
  });

  describe('When 0 servers are discovered', () => {
    it('should return null in non-interactive mode', async () => {
      const mockScanner = {
        scan: async () => []
      } as unknown as DevServerScanner;

      const selector = new ServerSelector(mockScanner, false);
      const target = await selector.selectTarget();
      expect(target).toBeNull();
    });

    it('should prompt user and accept manual port in interactive mode', async () => {
      const mockScanner = {
        scan: async () => []
      } as unknown as DevServerScanner;

      const rl = createMockReadline(['4200']);
      const selector = new ServerSelector(mockScanner, true);
      const target = await selector.selectTarget({ readlineInterface: rl });

      expect(target).not.toBeNull();
      expect(target?.port).toBe(4200);
    });

    it('should return null if user enters q', async () => {
      const mockScanner = {
        scan: async () => []
      } as unknown as DevServerScanner;

      const rl = createMockReadline(['q']);
      const selector = new ServerSelector(mockScanner, true);
      const target = await selector.selectTarget({ readlineInterface: rl });

      expect(target).toBeNull();
    });
  });

  describe('When 1 server is discovered', () => {
    it('should automatically select the server in non-interactive mode', async () => {
      const mockScanner = {
        scan: async () => [serverVite]
      } as unknown as DevServerScanner;

      const selector = new ServerSelector(mockScanner, false);
      const target = await selector.selectTarget();

      expect(target).not.toBeNull();
      expect(target?.port).toBe(5173);
      expect(target?.framework).toBe('vite');
    });

    it('should accept confirmation (Y) in interactive mode', async () => {
      const mockScanner = {
        scan: async () => [serverVite]
      } as unknown as DevServerScanner;

      const rl = createMockReadline(['y']);
      const selector = new ServerSelector(mockScanner, true);
      const target = await selector.selectTarget({ readlineInterface: rl });

      expect(target).not.toBeNull();
      expect(target?.port).toBe(5173);
    });

    it('should abort if user declines (n) in interactive mode', async () => {
      const mockScanner = {
        scan: async () => [serverVite]
      } as unknown as DevServerScanner;

      const rl = createMockReadline(['n']);
      const selector = new ServerSelector(mockScanner, true);
      const target = await selector.selectTarget({ readlineInterface: rl });

      expect(target).toBeNull();
    });
  });

  describe('When multiple servers are discovered', () => {
    it('should return null in non-interactive mode (never silently guess)', async () => {
      const mockScanner = {
        scan: async () => [serverVite, serverNext]
      } as unknown as DevServerScanner;

      const selector = new ServerSelector(mockScanner, false);
      const target = await selector.selectTarget();

      expect(target).toBeNull();
    });

    it('should select first server when user selects 1', async () => {
      const mockScanner = {
        scan: async () => [serverVite, serverNext]
      } as unknown as DevServerScanner;

      const rl = createMockReadline(['1']);
      const selector = new ServerSelector(mockScanner, true);
      const target = await selector.selectTarget({ readlineInterface: rl });

      expect(target).not.toBeNull();
      expect(target?.port).toBe(5173);
      expect(target?.framework).toBe('vite');
    });

    it('should select second server when user selects 2', async () => {
      const mockScanner = {
        scan: async () => [serverVite, serverNext]
      } as unknown as DevServerScanner;

      const rl = createMockReadline(['2']);
      const selector = new ServerSelector(mockScanner, true);
      const target = await selector.selectTarget({ readlineInterface: rl });

      expect(target).not.toBeNull();
      expect(target?.port).toBe(3000);
      expect(target?.framework).toBe('nextjs');
    });

    it('should exit cleanly when user enters q', async () => {
      const mockScanner = {
        scan: async () => [serverVite, serverNext]
      } as unknown as DevServerScanner;

      const rl = createMockReadline(['q']);
      const selector = new ServerSelector(mockScanner, true);
      const target = await selector.selectTarget({ readlineInterface: rl });

      expect(target).toBeNull();
    });
  });
});
