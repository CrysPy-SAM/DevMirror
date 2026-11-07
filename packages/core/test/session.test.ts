import { describe, it, expect } from 'vitest';
import { SessionManager } from '../src/session/manager.js';
import { SESSION_TTL_MS, SESSION_QUERY_PARAM } from '@devmirror/shared';

describe('SessionManager', () => {
  it('should generate cryptographically secure 256-bit base64url tokens', () => {
    const manager = new SessionManager();
    const token1 = manager.generateSecureToken();
    const token2 = manager.generateSecureToken();

    expect(token1).toHaveLength(43); // 32 bytes base64url encoded is 43 characters
    expect(token2).toHaveLength(43);
    expect(token1).not.toBe(token2);
    // Base64url characters only
    expect(token1).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('should create an active session with valid metadata and mobileUrl', () => {
    const manager = new SessionManager();
    const session = manager.createSession({
      target: { host: '127.0.0.1', port: 5173, framework: 'vite', isHttps: false },
      lanIp: '192.168.1.50',
      proxyPort: 4000,
      controlPort: 4100
    });

    expect(session.sessionId).toBeDefined();
    expect(session.token).toHaveLength(43);
    expect(session.lanIp).toBe('192.168.1.50');
    expect(session.proxyPort).toBe(4000);
    expect(session.controlPort).toBe(4100);
    expect(session.mobileUrl).toContain(`http://192.168.1.50:4000/?${SESSION_QUERY_PARAM}=${session.token}`);
    expect(session.expiresAt).toBeGreaterThan(Date.now());
    expect(manager.hasActiveSession()).toBe(true);
  });

  it('should accept valid tokens and reject invalid tokens using constant-time comparison', () => {
    const manager = new SessionManager();
    const session = manager.createSession({
      target: { host: '127.0.0.1', port: 3000, framework: 'nextjs', isHttps: false },
      lanIp: '10.0.0.2',
      proxyPort: 4000,
      controlPort: 4100
    });

    expect(manager.validateToken(session.token)).toBe(true);
    expect(manager.validateCookie(session.token)).toBe(true);

    expect(manager.validateToken('wrong-token-123456789012345678901234567890123')).toBe(false);
    expect(manager.validateToken('')).toBe(false);
    expect(manager.validateToken(null as any)).toBe(false);
    expect(manager.validateToken(undefined as any)).toBe(false);
  });

  it('should reject expired sessions', async () => {
    const manager = new SessionManager(50); // 50ms TTL
    const session = manager.createSession({
      target: { host: '127.0.0.1', port: 8080, framework: 'vanilla', isHttps: false },
      lanIp: '192.168.1.100',
      proxyPort: 4000,
      controlPort: 4100,
      ttlMs: 20 // 20ms TTL
    });

    expect(manager.validateToken(session.token)).toBe(true);

    // Wait for TTL expiration
    await new Promise((r) => setTimeout(r, 40));

    expect(manager.hasActiveSession()).toBe(false);
    expect(manager.validateToken(session.token)).toBe(false);
  });

  it('should handle session revocation cleanly', () => {
    const manager = new SessionManager();
    const session = manager.createSession({
      target: { host: '127.0.0.1', port: 4200, framework: 'angular', isHttps: false },
      lanIp: '192.168.1.20',
      proxyPort: 4000,
      controlPort: 4100
    });

    expect(manager.hasActiveSession()).toBe(true);
    manager.revokeSession();

    expect(manager.hasActiveSession()).toBe(false);
    expect(manager.getSession()).toBeNull();
    expect(manager.validateToken(session.token)).toBe(false);
  });

  it('should track multiple connected devices and detect device types', () => {
    const manager = new SessionManager();
    manager.createSession({
      target: { host: '127.0.0.1', port: 5173, framework: 'vite', isHttps: false },
      lanIp: '192.168.1.20',
      proxyPort: 4000,
      controlPort: 4100
    });

    const iphone = manager.registerDevice({
      ip: '192.168.1.88',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15'
    });

    const android = manager.registerDevice({
      ip: '192.168.1.99',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'
    });

    expect(iphone.deviceType).toBe('ios');
    expect(iphone.approved).toBe(true); // auto-trust
    expect(android.deviceType).toBe('android');

    const devices = manager.getConnectedDevices();
    expect(devices).toHaveLength(2);

    // Re-registering same device updates timestamp instead of duplicating
    const iphoneUpdated = manager.registerDevice({
      ip: '192.168.1.88',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15'
    });
    expect(iphoneUpdated.id).toBe(iphone.id);
    expect(manager.getConnectedDevices()).toHaveLength(2);

    // Remove device
    expect(manager.removeDevice(iphone.id)).toBe(true);
    expect(manager.getConnectedDevices()).toHaveLength(1);
  });

  it('should return sanitized session info masking the secret token', () => {
    const manager = new SessionManager();
    const session = manager.createSession({
      target: { host: '127.0.0.1', port: 5173, framework: 'vite', isHttps: false },
      lanIp: '192.168.1.20',
      proxyPort: 4000,
      controlPort: 4100
    });

    const sanitized = manager.getSanitizedSession();
    expect(sanitized).toBeDefined();
    // Raw token must never be present in sanitized output
    expect((sanitized as any).token).toBeUndefined();
    // Mobile URL should contain the masked token
    expect(sanitized!.mobileUrl).not.toContain(session.token);
    expect(sanitized!.mobileUrl).toContain('...');
  });
});
