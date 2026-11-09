import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { DevMirrorEngine } from '../src/server.js';
import { PasswordAuthManager } from '../src/auth/password.js';
import { SESSION_COOKIE_NAME } from '@devmirror/shared';

describe('DevMirror Dual Access Architecture E2E', () => {
  let targetHttpServer: http.Server;
  let targetWsServer: WebSocketServer;
  let targetPort: number;
  let engine: DevMirrorEngine;

  beforeEach(async () => {
    // 1. Create upstream dev server with HTTP and WebSocket support
    targetHttpServer = http.createServer((req, res) => {
      if (req.url === '/src/main.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end('console.log("DevMirror Vite Module Loaded");');
        return;
      }
      if (req.url === '/assets/style.css') {
        res.writeHead(200, { 'Content-Type': 'text/css' });
        res.end('body { background: #0f172a; }');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!DOCTYPE html><html><head><title>Target Dev Server</title></head><body><h1>Hello DevMirror</h1></body></html>');
    });

    targetWsServer = new WebSocketServer({ server: targetHttpServer });
    targetWsServer.on('connection', (ws) => {
      ws.on('message', (data) => {
        ws.send(`echo:${data.toString()}`);
      });
    });

    await new Promise<void>((resolve) => {
      targetHttpServer.listen(0, '127.0.0.1', () => {
        targetPort = (targetHttpServer.address() as any).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (engine && engine.running) {
      await engine.stop();
    }
    if (targetWsServer) {
      await new Promise<void>((resolve) => targetWsServer.close(() => resolve()));
    }
    if (targetHttpServer) {
      await new Promise<void>((resolve) => targetHttpServer.close(() => resolve()));
    }
  });

  it('1. LAN Access: QR token pairing redirects with session cookie and proxies to dev server', async () => {
    engine = new DevMirrorEngine({
      preferredProxyPort: 4810,
      preferredControlPort: 4820,
      target: {
        host: '127.0.0.1',
        port: targetPort,
        framework: 'vite',
        isHttps: false
      }
    });

    const started = await engine.start();
    const token = started.session!.token;
    const proxyPort = started.proxyPort;

    // Pairing request with QR token: GET /?dm_token=<token>
    const pairingRes = await new Promise<{
      statusCode?: number;
      headers: http.IncomingHttpHeaders;
    }>((resolve, reject) => {
      http.get(`http://127.0.0.1:${proxyPort}/?dm_token=${token}`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers }));
      }).on('error', reject);
    });

    expect(pairingRes.statusCode).toBe(302);
    expect(pairingRes.headers.location).toBe('/');
    expect(pairingRes.headers['set-cookie']).toBeDefined();

    const cookieHeader = pairingRes.headers['set-cookie']![0];
    expect(cookieHeader).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookieHeader.toLowerCase()).toContain('httponly');

    // Subsequent request with dm_session cookie: GET /
    const sessionCookie = cookieHeader.split(';')[0];
    const proxyRes = await new Promise<{ statusCode?: number; body: string }>((resolve, reject) => {
      http.get(
        `http://127.0.0.1:${proxyPort}/`,
        { headers: { Cookie: sessionCookie } },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ statusCode: res.statusCode, body }));
        }
      ).on('error', reject);
    });

    expect(proxyRes.statusCode).toBe(200);
    expect(proxyRes.body).toContain('Target Dev Server');
    expect(proxyRes.body).toContain('Hello DevMirror');
  });

  it('2. Public Access: Unauthenticated visitor receives mobile password login page', async () => {
    const password = 'test-dual-access-pwd';
    engine = new DevMirrorEngine({
      preferredProxyPort: 4811,
      preferredControlPort: 4821,
      target: {
        host: '127.0.0.1',
        port: targetPort,
        framework: 'vite',
        isHttps: false
      }
    });

    const started = await engine.start();
    const proxyPort = started.proxyPort;

    // Attach password auth manager to proxy server
    const authManager = new PasswordAuthManager({ customPassword: password });
    engine.proxy!.setPasswordAuth(authManager);

    // Unauthenticated GET / without token or cookie
    const res = await new Promise<{ statusCode?: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      http.get(`http://127.0.0.1:${proxyPort}/`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
      }).on('error', reject);
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('DevMirror Mobile Preview');
    expect(res.body).toContain('action="/__devmirror/auth"');
    expect(res.body).toContain('type="password"');
    expect(res.body).toContain('Unlock Preview');
  });

  it('3. Public Access: Incorrect password returns 401 with error message', async () => {
    const password = 'correct-password-123';
    engine = new DevMirrorEngine({
      preferredProxyPort: 4812,
      preferredControlPort: 4822,
      target: {
        host: '127.0.0.1',
        port: targetPort,
        framework: 'vite',
        isHttps: false
      }
    });

    const started = await engine.start();
    const proxyPort = started.proxyPort;
    const authManager = new PasswordAuthManager({ customPassword: password });
    engine.proxy!.setPasswordAuth(authManager);

    // POST /__devmirror/auth with wrong password
    const postData = 'password=wrong-password&returnTo=/';
    const postRes = await new Promise<{ statusCode?: number; body: string }>((resolve, reject) => {
      const req = http.request(
        `http://127.0.0.1:${proxyPort}/__devmirror/auth`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData)
          }
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ statusCode: res.statusCode, body }));
        }
      );
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    expect(postRes.statusCode).toBe(401);
    expect(postRes.body).toContain('Invalid password');
  });

  it('4. Public Access: Correct password authenticates, issues session cookie and redirects', async () => {
    const password = 'super-secret-preview-pwd';
    engine = new DevMirrorEngine({
      preferredProxyPort: 4813,
      preferredControlPort: 4823,
      target: {
        host: '127.0.0.1',
        port: targetPort,
        framework: 'vite',
        isHttps: false
      }
    });

    const started = await engine.start();
    const proxyPort = started.proxyPort;
    const authManager = new PasswordAuthManager({ customPassword: password });
    engine.proxy!.setPasswordAuth(authManager);

    // POST /__devmirror/auth with correct password
    const postData = `password=${encodeURIComponent(password)}&returnTo=%2Fdashboard`;
    const postRes = await new Promise<{
      statusCode?: number;
      headers: http.IncomingHttpHeaders;
    }>((resolve, reject) => {
      const req = http.request(
        `http://127.0.0.1:${proxyPort}/__devmirror/auth`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData)
          }
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers }));
        }
      );
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    expect(postRes.statusCode).toBe(302);
    expect(postRes.headers.location).toBe('/dashboard');
    expect(postRes.headers['set-cookie']).toBeDefined();

    const cookieHeader = postRes.headers['set-cookie']![0];
    expect(cookieHeader).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookieHeader.toLowerCase()).toContain('httponly');
    expect(cookieHeader.toLowerCase()).toContain('samesite=lax');
  });

  it('5. Authenticated Asset & HTML Access: Session cookie allows asset requests', async () => {
    const password = 'asset-access-password';
    engine = new DevMirrorEngine({
      preferredProxyPort: 4814,
      preferredControlPort: 4824,
      target: {
        host: '127.0.0.1',
        port: targetPort,
        framework: 'vite',
        isHttps: false
      }
    });

    const started = await engine.start();
    const proxyPort = started.proxyPort;
    const authManager = new PasswordAuthManager({ customPassword: password });
    engine.proxy!.setPasswordAuth(authManager);

    // 1. Authenticate with password
    const postData = `password=${encodeURIComponent(password)}`;
    const postRes = await new Promise<{ headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const req = http.request(
        `http://127.0.0.1:${proxyPort}/__devmirror/auth`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData)
          }
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ headers: res.headers }));
        }
      );
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    const sessionCookie = postRes.headers['set-cookie']![0].split(';')[0];

    // 2. Fetch JS asset with cookie
    const jsRes = await new Promise<{ statusCode?: number; body: string }>((resolve, reject) => {
      http.get(
        `http://127.0.0.1:${proxyPort}/src/main.js`,
        { headers: { Cookie: sessionCookie } },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ statusCode: res.statusCode, body }));
        }
      ).on('error', reject);
    });

    expect(jsRes.statusCode).toBe(200);
    expect(jsRes.body).toContain('DevMirror Vite Module Loaded');

    // 3. Fetch CSS asset with cookie
    const cssRes = await new Promise<{ statusCode?: number; body: string }>((resolve, reject) => {
      http.get(
        `http://127.0.0.1:${proxyPort}/assets/style.css`,
        { headers: { Cookie: sessionCookie } },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ statusCode: res.statusCode, body }));
        }
      ).on('error', reject);
    });

    expect(cssRes.statusCode).toBe(200);
    expect(cssRes.body).toContain('background: #0f172a');
  });

  it('6. Unauthenticated Asset Access Rejection: Direct asset requests without cookie return 401', async () => {
    const password = 'auth-guard-test';
    engine = new DevMirrorEngine({
      preferredProxyPort: 4815,
      preferredControlPort: 4825,
      target: {
        host: '127.0.0.1',
        port: targetPort,
        framework: 'vite',
        isHttps: false
      }
    });

    const started = await engine.start();
    const proxyPort = started.proxyPort;
    const authManager = new PasswordAuthManager({ customPassword: password });
    engine.proxy!.setPasswordAuth(authManager);

    // Direct unauthenticated fetch of /src/main.js
    const unauthJsRes = await new Promise<{ statusCode?: number; body: string }>((resolve, reject) => {
      http.get(`http://127.0.0.1:${proxyPort}/src/main.js`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      }).on('error', reject);
    });

    expect(unauthJsRes.statusCode).toBe(401);
    expect(unauthJsRes.body).toContain('Unauthorized: Valid DevMirror session required');
    expect(unauthJsRes.body).not.toContain('DevMirror Vite Module Loaded');
  });

  it('7. Public WebSocket & HMR Access: trycloudflare.com Origin and session cookie succeed', async () => {
    const password = 'ws-hmr-password';
    engine = new DevMirrorEngine({
      preferredProxyPort: 4816,
      preferredControlPort: 4826,
      target: {
        host: '127.0.0.1',
        port: targetPort,
        framework: 'vite',
        isHttps: false
      }
    });

    const started = await engine.start();
    const proxyPort = started.proxyPort;
    const authManager = new PasswordAuthManager({ customPassword: password });
    engine.proxy!.setPasswordAuth(authManager);

    // 1. Authenticate to get session cookie
    const postData = `password=${encodeURIComponent(password)}`;
    const postRes = await new Promise<{ headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const req = http.request(
        `http://127.0.0.1:${proxyPort}/__devmirror/auth`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData)
          }
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ headers: res.headers }));
        }
      );
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    const sessionCookie = postRes.headers['set-cookie']![0].split(';')[0];

    // 2. Connect WebSocket with trycloudflare.com Origin and session cookie
    const ws = new WebSocket(`ws://127.0.0.1:${proxyPort}/`, {
      headers: {
        Cookie: sessionCookie,
        Origin: 'https://test-preview-dual-access.trycloudflare.com'
      }
    });

    const receivedMessage = await new Promise<string>((resolve, reject) => {
      ws.on('open', () => {
        ws.send('hmr:ping');
      });
      ws.on('message', (data) => {
        resolve(data.toString());
      });
      ws.on('error', reject);
    });

    expect(receivedMessage).toBe('echo:hmr:ping');
    ws.close();

    // 3. Verify unauthenticated WebSocket connection is rejected
    const unauthWs = new WebSocket(`ws://127.0.0.1:${proxyPort}/`, {
      headers: {
        Origin: 'https://test-preview-dual-access.trycloudflare.com'
      }
    });

    const errorOrClosed = await new Promise<boolean>((resolve) => {
      unauthWs.on('error', () => resolve(true));
      unauthWs.on('close', (code) => resolve(code !== 1000));
    });
    expect(errorOrClosed).toBe(true);
  });

  it('8. Tunnel Failure Resilience: LAN preview continues working if tunnel fails', async () => {
    // Specify a non-existent binary path for cloudflared
    engine = new DevMirrorEngine({
      preferredProxyPort: 4817,
      preferredControlPort: 4827,
      target: {
        host: '127.0.0.1',
        port: targetPort,
        framework: 'vite',
        isHttps: false
      },
      enableTunnel: true,
      cloudflaredPath: 'non-existent-cloudflared-binary-12345',
      tunnelTimeoutMs: 1000
    });

    // Engine start must not throw; it should log a warning and proceed with LAN access
    const started = await engine.start();

    expect(started.proxyPort).toBeGreaterThan(0);
    expect(started.controlPort).toBeGreaterThan(0);
    expect(started.tunnelInfo).toBeDefined();
    expect(started.tunnelInfo?.status).toBe('failed');

    // LAN access works normally
    const token = started.session!.token;
    const pairingRes = await new Promise<{ statusCode?: number }>((resolve, reject) => {
      http.get(`http://127.0.0.1:${started.proxyPort}/?dm_token=${token}`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ statusCode: res.statusCode }));
      }).on('error', reject);
    });

    expect(pairingRes.statusCode).toBe(302);
  });

  it('9. Control API Isolation: Control API remains bound to loopback and checks origin', async () => {
    engine = new DevMirrorEngine({
      preferredProxyPort: 4818,
      preferredControlPort: 4828,
      target: {
        host: '127.0.0.1',
        port: targetPort,
        framework: 'vite',
        isHttps: false
      }
    });

    const started = await engine.start();
    const controlPort = started.controlPort;

    // Health check from loopback succeeds
    const healthRes = await fetch(`http://127.0.0.1:${controlPort}/health`);
    expect(healthRes.status).toBe(200);
    const healthJson = await healthRes.json();
    expect(healthJson.status).toBe('ok');

    // Request with untrusted Origin header is rejected
    const untrustedRes = await fetch(`http://127.0.0.1:${controlPort}/session`, {
      headers: {
        Origin: 'https://malicious-public-site.com'
      }
    });
    expect(untrustedRes.status).toBe(403);
  });
});
