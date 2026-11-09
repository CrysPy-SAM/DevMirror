import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { CloudflareTunnel } from '../src/tunnel/cloudflare.js';

describe('CloudflareTunnel', () => {
  it('should initialize with idle status', () => {
    const tunnel = new CloudflareTunnel({ proxyPort: 4000 });
    expect(tunnel.status).toBe('idle');
    expect(tunnel.publicUrl).toBeUndefined();
    expect(tunnel.getInfo()).toEqual({ status: 'idle', url: undefined, error: undefined });
  });

  it('should parse trycloudflare.com URL from process output and transition to connected', async () => {
    // Create mock ChildProcess
    const mockProcess: any = new EventEmitter();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.pid = 99999;
    mockProcess.kill = () => true;

    const mockSpawn: any = () => {
      // Emit startup logs asynchronously
      setTimeout(() => {
        mockProcess.stderr.emit('data', '2026-11-08T12:00:00Z INF Starting tunnel tunnelID=abc\n');
        mockProcess.stderr.emit(
          'data',
          '2026-11-08T12:00:01Z INF Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):\nhttps://bright-panda-123.trycloudflare.com\n'
        );
      }, 50);
      return mockProcess;
    };

    const tunnel = new CloudflareTunnel({
      proxyPort: 4000,
      spawnFn: mockSpawn
    });

    const url = await tunnel.start();
    expect(url).toBe('https://bright-panda-123.trycloudflare.com');
    expect(tunnel.status).toBe('connected');
    expect(tunnel.publicUrl).toBe('https://bright-panda-123.trycloudflare.com');

    await tunnel.stop();
    expect(tunnel.status).toBe('stopped');
  });

  it('should handle missing executable (ENOENT) gracefully without crashing', async () => {
    const mockProcess: any = new EventEmitter();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();

    const mockSpawn: any = () => {
      setTimeout(() => {
        const err: any = new Error('spawn cloudflared ENOENT');
        err.code = 'ENOENT';
        mockProcess.emit('error', err);
      }, 20);
      return mockProcess;
    };

    const tunnel = new CloudflareTunnel({
      proxyPort: 4000,
      spawnFn: mockSpawn
    });

    await expect(tunnel.start()).rejects.toThrow('cloudflared binary not found');
    expect(tunnel.status).toBe('failed');
    expect(tunnel.getInfo().error).toContain('Install cloudflared');
  });

  it('should reject when process exits prematurely with non-zero exit code', async () => {
    const mockProcess: any = new EventEmitter();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.kill = () => true;

    const mockSpawn: any = () => {
      setTimeout(() => {
        mockProcess.stderr.emit('data', 'Error: authentication required\n');
        mockProcess.emit('exit', 1, null);
      }, 30);
      return mockProcess;
    };

    const tunnel = new CloudflareTunnel({
      proxyPort: 4000,
      spawnFn: mockSpawn
    });

    await expect(tunnel.start()).rejects.toThrow('cloudflared exited unexpectedly with code 1');
    expect(tunnel.status).toBe('failed');
  });

  it('should timeout if tunnel URL is never emitted', async () => {
    const mockProcess: any = new EventEmitter();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.kill = () => true;

    const mockSpawn: any = () => mockProcess;

    const tunnel = new CloudflareTunnel({
      proxyPort: 4000,
      timeoutMs: 100,
      spawnFn: mockSpawn
    });

    await expect(tunnel.start()).rejects.toThrow('timed out');
    expect(tunnel.status).toBe('failed');
  });
});
