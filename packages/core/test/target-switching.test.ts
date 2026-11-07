/**
 * DevMirror - Milestone 7: Dynamic Target Switching & Session Lifecycle Tests
 *
 * Verifies:
 * 1. Starting DevMirrorEngine with Server A (e.g. Vite on Port A).
 * 2. Dynamically switching target to Server B (e.g. Next.js on Port B) via engine.setTarget() and Control API.
 * 3. Immediate rerouting of HTTP proxy requests to Server B.
 * 4. Graceful closure of active WebSocket connections to Server A to prompt client reconnection.
 * 5. Session token & cookie continuity across target switches.
 * 6. Revoking session cleans up sockets and enforces 401 on subsequent requests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { DevMirrorEngine } from '../src/server.js';
import {
  CONTROL_API_CLI_HEADER,
  SESSION_COOKIE_NAME,
  SESSION_QUERY_PARAM
} from '@devmirror/shared';

describe('Dynamic Target Switching & Session Lifecycle (Milestone 7)', () => {
  let engine: DevMirrorEngine;
  let serverA: http.Server;
  let serverB: http.Server;
  let wssA: WebSocketServer;
  let wssB: WebSocketServer;
  let portA: number;
  let portB: number;

  beforeEach(async () => {
    // 1. Setup Server A (Vite)
    serverA = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h1>Project A - Vite</h1></body></html>');
    });
    wssA = new WebSocketServer({ noServer: true });
    serverA.on('upgrade', (req, socket, head) => {
      wssA.handleUpgrade(req, socket, head, (ws) => {
        wssA.emit('connection', ws, req);
      });
    });
    await new Promise<void>((resolve) => {
      serverA.listen(0, '127.0.0.1', () => {
        portA = (serverA.address() as any).port;
        resolve();
      });
    });

    // 2. Setup Server B (Next.js)
    serverB = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h1>Project B - Next.js</h1></body></html>');
    });
    wssB = new WebSocketServer({ noServer: true });
    serverB.on('upgrade', (req, socket, head) => {
      wssB.handleUpgrade(req, socket, head, (ws) => {
        wssB.emit('connection', ws, req);
      });
    });
    await new Promise<void>((resolve) => {
      serverB.listen(0, '127.0.0.1', () => {
        portB = (serverB.address() as any).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (engine && engine.running) {
      await engine.stop();
    }
    if (wssA) wssA.close();
    if (wssB) wssB.close();
    await new Promise<void>((resolve) => serverA.close(() => resolve()));
    await new Promise<void>((resolve) => serverB.close(() => resolve()));
  });

  it('should switch upstream targets dynamically and terminate stale WebSocket sockets', async () => {
    // 1. Start Engine with Server A
    engine = new DevMirrorEngine({
      preferredProxyPort: 4710,
      preferredControlPort: 4760,
      target: {
        host: '127.0.0.1',
        port: portA,
        framework: 'vite',
        isHttps: false
      }
    });

    const startInfo = await engine.start();
    const proxyPort = startInfo.proxyPort;
    const token = startInfo.session?.token!;
    expect(token).toBeDefined();

    // 2. Request through proxy targeting Server A
    const resA = await fetch(`http://127.0.0.1:${proxyPort}/`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` }
    });
    expect(resA.status).toBe(200);
    const htmlA = await resA.text();
    expect(htmlA).toContain('Project A - Vite');

    // 3. Connect a client WebSocket to Server A
    wssA.on('connection', (ws) => {
      ws.send('welcome-server-a');
    });

    const wsUrlA = `ws://127.0.0.1:${proxyPort}/@vite-hmr?${SESSION_QUERY_PARAM}=${token}`;
    const wsClientA = new WebSocket(wsUrlA, ['vite-hmr']);

    const wsMessagePromise = new Promise<string>((resolve) => {
      wsClientA.on('message', (d) => resolve(d.toString()));
    });
    const wsMsg = await wsMessagePromise;
    expect(wsMsg).toBe('welcome-server-a');

    // Set up disconnect listener on old client WebSocket
    let clientDisconnected = false;
    wsClientA.once('close', () => {
      clientDisconnected = true;
    });

    // 4. Switch target to Server B via engine.setTarget
    await engine.setTarget({
      host: '127.0.0.1',
      port: portB,
      framework: 'nextjs',
      isHttps: false
    });

    // Verify old client WebSocket was immediately terminated
    await new Promise((r) => setTimeout(r, 60));
    expect(clientDisconnected).toBe(true);

    // 5. Verify new HTTP requests through proxy route to Server B immediately with same session
    const resB = await fetch(`http://127.0.0.1:${proxyPort}/`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` }
    });
    expect(resB.status).toBe(200);
    const htmlB = await resB.text();
    expect(htmlB).toContain('Project B - Next.js');

    // 6. Connect a new WebSocket to Server B
    wssB.on('connection', (ws) => {
      ws.send('welcome-server-b');
    });

    const wsUrlB = `ws://127.0.0.1:${proxyPort}/_next/webpack-hmr?${SESSION_QUERY_PARAM}=${token}`;
    const wsClientB = new WebSocket(wsUrlB);

    const wsBMsgPromise = new Promise<string>((resolve) => {
      wsClientB.on('message', (d) => resolve(d.toString()));
    });
    const wsBMsg = await wsBMsgPromise;
    expect(wsBMsg).toBe('welcome-server-b');
    wsClientB.close();
  });

  it('should switch target via Control API POST /api/v1/session', async () => {
    engine = new DevMirrorEngine({
      preferredProxyPort: 4720,
      preferredControlPort: 4770,
      target: {
        host: '127.0.0.1',
        port: portA,
        framework: 'vite',
        isHttps: false
      }
    });

    const startInfo = await engine.start();
    const proxyPort = startInfo.proxyPort;
    const controlPort = startInfo.controlPort;
    const token = startInfo.session?.token!;

    // Call Control API to switch target to Server B
    const postRes = await fetch(`http://127.0.0.1:${controlPort}/api/v1/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CONTROL_API_CLI_HEADER]: '1'
      },
      body: JSON.stringify({
        target: {
          port: portB,
          host: '127.0.0.1',
          framework: 'nextjs',
          frameworkName: 'Next.js 14'
        }
      })
    });

    expect(postRes.status).toBe(200);
    const postData = await postRes.json();
    expect(postData.success).toBe(true);
    expect(postData.session.target.port).toBe(portB);

    // Verify proxy now forwards to Server B
    const res = await fetch(`http://127.0.0.1:${proxyPort}/`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` }
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Project B - Next.js');
  });

  it('should handle session revocation cleanly via DELETE /api/v1/session', async () => {
    engine = new DevMirrorEngine({
      preferredProxyPort: 4730,
      preferredControlPort: 4780,
      target: {
        host: '127.0.0.1',
        port: portA,
        framework: 'vite',
        isHttps: false
      }
    });

    const startInfo = await engine.start();
    const proxyPort = startInfo.proxyPort;
    const controlPort = startInfo.controlPort;
    const token = startInfo.session?.token!;

    // Verify active access
    const resBefore = await fetch(`http://127.0.0.1:${proxyPort}/`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` }
    });
    expect(resBefore.status).toBe(200);

    // Revoke session
    const deleteRes = await fetch(`http://127.0.0.1:${controlPort}/api/v1/session`, {
      method: 'DELETE',
      headers: {
        [CONTROL_API_CLI_HEADER]: '1'
      }
    });
    expect(deleteRes.status).toBe(200);

    // Subsequent requests must be rejected with 401
    const resAfter = await fetch(`http://127.0.0.1:${proxyPort}/`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` }
    });
    expect(resAfter.status).toBe(401);
  });
});
