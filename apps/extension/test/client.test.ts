import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { ControlApiClient } from '../src/api/client.js';
import { CONTROL_API_CSRF_HEADER } from '@devmirror/shared';

describe('ControlApiClient Integration', () => {
  let mockServer: http.Server;
  let mockPort: number;
  let client: ControlApiClient;
  let lastHeaders: http.IncomingHttpHeaders;
  let lastMethod: string | undefined;
  let lastUrl: string | undefined;
  let lastBody: any = null;

  beforeEach(async () => {
    mockServer = http.createServer((req, res) => {
      lastMethod = req.method;
      lastUrl = req.url;
      lastHeaders = req.headers;

      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        if (chunks.length > 0) {
          try {
            lastBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          } catch {
            lastBody = null;
          }
        } else {
          lastBody = null;
        }

        // Mock routes
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', version: '0.1.0', uptimeSeconds: 120 }));
        } else if (req.url === '/api/v1/session' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              session: {
                sessionId: 'uuid-1234',
                target: { host: '127.0.0.1', port: 5173, framework: 'vite' },
                lanIp: '192.168.1.50',
                proxyPort: 4000,
                controlPort: 4100,
                mobileUrl: 'http://192.168.1.50:4000/?dm_token=masked***',
                connectedClients: []
              },
              activeControlPort: 4100,
              activeProxyPort: 4000
            })
          );
        } else if (req.url === '/api/v1/session/pairing-url') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ pairingUrl: 'http://192.168.1.50:4000/?dm_token=unmasked_secret_token' }));
        } else if (req.url === '/api/v1/session' && req.method === 'POST') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } else if (req.url === '/api/v1/session' && req.method === 'DELETE') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } else if (req.url === '/api/v1/discover') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ servers: [{ port: 5173, framework: 'vite' }], total: 1 }));
        } else if (req.url === '/api/v1/devices') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ devices: [{ id: 'd-1', ip: '192.168.1.80', deviceType: 'ios' }], total: 1 }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
        }
      });
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        mockPort = (mockServer.address() as any).port;
        client = new ControlApiClient({ host: '127.0.0.1', port: mockPort });
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  });

  it('should fetch agent health successfully', async () => {
    const health = await client.checkHealth();
    expect(health).not.toBeNull();
    expect(health?.status).toBe('ok');
    expect(health?.version).toBe('0.1.0');
    expect(health?.uptimeSeconds).toBe(120);
  });

  it('should return null when health check fails or agent is unreachable', async () => {
    const deadClient = new ControlApiClient({ host: '127.0.0.1', port: 65431 });
    const health = await deadClient.checkHealth();
    expect(health).toBeNull();
  });

  it('should fetch active session details', async () => {
    const sessionRes = await client.getSession();
    expect(sessionRes).not.toBeNull();
    expect(sessionRes?.session.target.port).toBe(5173);
    expect(sessionRes?.activeProxyPort).toBe(4000);
  });

  it('should fetch unmasked pairing URL for trusted extension', async () => {
    const url = await client.getPairingUrl();
    expect(url).toBe('http://192.168.1.50:4000/?dm_token=unmasked_secret_token');
  });

  it('should send CSRF header and JSON payload when starting a session', async () => {
    const success = await client.startSession({ port: 3000, host: '127.0.0.1', framework: 'nextjs' });
    expect(success).toBe(true);
    expect(lastMethod).toBe('POST');
    expect(lastUrl).toBe('/api/v1/session');
    expect(lastHeaders[CONTROL_API_CSRF_HEADER]).toBe('1');
    expect(lastBody.target.port).toBe(3000);
    expect(lastBody.target.framework).toBe('nextjs');
  });

  it('should send CSRF header when stopping a session', async () => {
    const success = await client.stopSession();
    expect(success).toBe(true);
    expect(lastMethod).toBe('DELETE');
    expect(lastUrl).toBe('/api/v1/session');
    expect(lastHeaders[CONTROL_API_CSRF_HEADER]).toBe('1');
  });

  it('should discover servers and list devices', async () => {
    const disc = await client.discoverServers();
    expect(disc.servers.length).toBe(1);
    expect(disc.servers[0].port).toBe(5173);

    const dev = await client.getDevices();
    expect(dev.devices.length).toBe(1);
    expect(dev.devices[0].deviceType).toBe('ios');
  });

  it('should update config dynamically', () => {
    client.updateConfig({ port: 4200 });
    expect(client.baseUrl).toBe('http://127.0.0.1:4200');
  });
});
