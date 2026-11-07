import { describe, it, expect } from 'vitest';
import { buildMobilePreviewUrl, generateTerminalQr } from '../src/qr.js';

describe('QR Code & Mobile Preview URL Generator', () => {
  it('should build correct mobile preview URL with token and IPv4', () => {
    const url = buildMobilePreviewUrl('192.168.1.50', 4000, 'testToken12345');
    expect(url).toBe('http://192.168.1.50:4000/?dm_token=testToken12345');
  });

  it('should build correct mobile preview URL with IPv6 bracket notation', () => {
    const url = buildMobilePreviewUrl('::1', 4000, 'testToken12345');
    expect(url).toBe('http://[::1]:4000/?dm_token=testToken12345');
  });

  it('should generate terminal QR ASCII string for a valid URL', async () => {
    const url = 'http://192.168.1.50:4000/?dm_token=tokenABC';
    const qr = await generateTerminalQr(url, true);

    expect(typeof qr).toBe('string');
    expect(qr.length).toBeGreaterThan(50);
  });
});
