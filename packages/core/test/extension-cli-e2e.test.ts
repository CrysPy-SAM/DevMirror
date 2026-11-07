/**
 * DevMirror - Milestone 7: Cross-Package Control API, CLI & Chrome Extension E2E Integration
 *
 * Verifies:
 * 1. DevMirrorEngine Control API responding to CLI requests with x-devmirror-cli header.
 * 2. DevMirrorEngine Control API responding to Chrome Extension requests with trusted origin.
 * 3. Prohibiting localhost web origins from accessing /api/v1/session/pairing-url.
 * 4. CSRF protection on POST/DELETE /api/v1/session.
 * 5. Dynamic server discovery via onDiscover hook wired to DevServerScanner.
 * 6. Device registration through LAN proxy and inspection via /api/v1/devices.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { DevMirrorEngine } from '../src/server.js';
import {
  CONTROL_API_CLI_HEADER,
  CONTROL_API_CSRF_HEADER,
  DEVMIRROR_DEV_EXTENSION_ID,
  SESSION_QUERY_PARAM
} from '@devmirror/shared';

describe('Cross-Package Control API, CLI & Extension E2E (Milestone 7)', () => {
  let engine: DevMirrorEngine;
  let devServer: http.Server;
  let devPort: number;
  let controlPort: number;
  let proxyPort: number;
  let sessionToken: string;
  let portOffset = 0;

  beforeEach(async () => {
    portOffset += 30;
    // 1. Setup dev server
    devServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>E2E Target Dev Server</h1>');
    });

    await new Promise<void>((resolve) => {
      devServer.listen(0, '127.0.0.1', () => {
        devPort = (devServer.address() as any).port;
        resolve();
      });
    });

    // 2. Setup DevMirrorEngine with onDiscover hook simulating real discovery
    engine = new DevMirrorEngine({
      preferredProxyPort: 4800 + portOffset,
      preferredControlPort: 4850 + portOffset,
      target: {
        host: '127.0.0.1',
        port: devPort,
        framework: 'vite',
        isHttps: false
      },
      allowedExtensionIds: [DEVMIRROR_DEV_EXTENSION_ID],
      onDiscover: async () => {
        return [
          {
            host: '127.0.0.1',
            port: devPort,
            url: `http://127.0.0.1:${devPort}`,
            framework: 'vite',
            frameworkName: 'Vite',
            status: 'online',
            confidence: 'high',
            isHttps: false
          }
        ];
      }
    });

    const startInfo = await engine.start();
    controlPort = startInfo.controlPort;
    proxyPort = startInfo.proxyPort;
    sessionToken = startInfo.session?.token!;
  });

  afterEach(async () => {
    if (engine && engine.running) {
      await engine.stop();
    }
    await new Promise<void>((resolve) => devServer.close(() => resolve()));
  });

  it('should allow trusted Chrome Extension to fetch pairing URL while rejecting web origins', async () => {
    const extensionOrigin = `chrome-extension://${DEVMIRROR_DEV_EXTENSION_ID}`;

    // 1. Trusted Chrome Extension Origin -> 200 OK
    const extRes = await fetch(`http://127.0.0.1:${controlPort}/api/v1/session/pairing-url`, {
      headers: {
        Origin: extensionOrigin
      }
    });
    expect(extRes.status).toBe(200);
    const extData = await extRes.json();
    expect(extData.pairingUrl).toContain(sessionToken);
    // Raw token must NOT be returned as a separate field
    expect(extData.token).toBeUndefined();

    // 2. Localhost Web Origin (e.g. from malicious web script on port 3000) -> 403 Forbidden
    const webRes = await fetch(`http://127.0.0.1:${controlPort}/api/v1/session/pairing-url`, {
      headers: {
        Origin: 'http://localhost:3000'
      }
    });
    expect(webRes.status).toBe(403);
    const webData = await webRes.json();
    expect(webData.error).toContain('Forbidden');

    // 3. CLI request with intent header -> 200 OK
    const cliRes = await fetch(`http://127.0.0.1:${controlPort}/api/v1/session/pairing-url`, {
      headers: {
        [CONTROL_API_CLI_HEADER]: '1'
      }
    });
    expect(cliRes.status).toBe(200);
    const cliData = await cliRes.json();
    expect(cliData.pairingUrl).toContain(sessionToken);
  });

  it('should support server discovery and device tracking', async () => {
    const extensionOrigin = `chrome-extension://${DEVMIRROR_DEV_EXTENSION_ID}`;

    // 1. Discover servers via Control API
    const discRes = await fetch(`http://127.0.0.1:${controlPort}/api/v1/discover`, {
      headers: { Origin: extensionOrigin }
    });
    expect(discRes.status).toBe(200);
    const discData = await discRes.json();
    expect(discData.servers.length).toBe(1);
    expect(discData.servers[0].port).toBe(devPort);

    // 2. Mobile device scans QR code (connects to proxy with ?dm_token=...)
    const mobileRes = await fetch(`http://127.0.0.1:${proxyPort}/?${SESSION_QUERY_PARAM}=${sessionToken}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)'
      },
      redirect: 'manual'
    });
    expect(mobileRes.status).toBe(302);

    // 3. Extension inspects connected devices list
    const devRes = await fetch(`http://127.0.0.1:${controlPort}/api/v1/devices`, {
      headers: { Origin: extensionOrigin }
    });
    expect(devRes.status).toBe(200);
    const devData = await devRes.json();
    expect(devData.devices.length).toBe(1);
    expect(devData.devices[0].deviceType).toBe('ios');
    expect(devData.devices[0].approved).toBe(true);
  });

  it('should enforce CSRF token header for state-changing requests from extension', async () => {
    const extensionOrigin = `chrome-extension://${DEVMIRROR_DEV_EXTENSION_ID}`;

    // 1. POST without CSRF header -> 403 Forbidden
    const unauthPost = await fetch(`http://127.0.0.1:${controlPort}/api/v1/session`, {
      method: 'POST',
      headers: {
        Origin: extensionOrigin,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ target: { port: 5000 } })
    });
    expect(unauthPost.status).toBe(403);

    // 2. POST with CSRF header -> 200 OK
    const authPost = await fetch(`http://127.0.0.1:${controlPort}/api/v1/session`, {
      method: 'POST',
      headers: {
        Origin: extensionOrigin,
        'Content-Type': 'application/json',
        [CONTROL_API_CSRF_HEADER]: '1'
      },
      body: JSON.stringify({ target: { port: 5000, host: '127.0.0.1' } })
    });
    expect(authPost.status).toBe(200);
  });
});
