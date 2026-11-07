import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { DevMirrorEngine } from '../src/server.js';

describe('DevMirrorEngine', () => {
  let engine: DevMirrorEngine;
  let mockTarget: http.Server;
  let targetPort: number;

  afterEach(async () => {
    if (engine && engine.running) {
      await engine.stop();
    }
    if (mockTarget) {
      await new Promise<void>((resolve) => mockTarget.close(() => resolve()));
    }
  });

  it('should start control API and LAN proxy, auto-assign ports, and shutdown cleanly', async () => {
    // 1. Mock dev server
    mockTarget = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('OK from Target');
    });
    await new Promise<void>((resolve) => {
      mockTarget.listen(0, '127.0.0.1', () => {
        targetPort = (mockTarget.address() as any).port;
        resolve();
      });
    });

    engine = new DevMirrorEngine({
      preferredProxyPort: 4900,
      preferredControlPort: 4950,
      target: {
        host: '127.0.0.1',
        port: targetPort,
        framework: 'vite',
        isHttps: false
      }
    });

    const started = await engine.start();

    expect(started.proxyPort).toBe(4900);
    expect(started.controlPort).toBe(4950);
    expect(started.lanIp).toBeDefined();
    expect(started.session).toBeDefined();
    expect(started.sanitizedSession).toBeDefined();
    expect(engine.running).toBe(true);

    // Verify control API responds on loopback
    const healthRes = await fetch(`http://127.0.0.1:${started.controlPort}/health`);
    expect(healthRes.status).toBe(200);
    const healthJson = await healthRes.json();
    expect(healthJson.status).toBe('ok');

    // Verify graceful shutdown
    await engine.stop();
    expect(engine.running).toBe(false);

    // Port should be released and connections refused
    await expect(fetch(`http://127.0.0.1:${started.controlPort}/health`)).rejects.toThrow();
  });
});
