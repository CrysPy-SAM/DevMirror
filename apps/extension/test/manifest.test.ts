import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEVMIRROR_DEV_EXTENSION_ID, DEVMIRROR_DEV_EXTENSION_KEY } from '@devmirror/shared';

describe('Chrome Extension Manifest V3 Validation', () => {
  const manifestPath = path.resolve(__dirname, '../public/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  it('should comply strictly with Manifest V3', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('DevMirror - Mobile Preview Dashboard');
    expect(manifest.version).toBe('0.1.0');
    expect(manifest.action).toBeDefined();
    expect(manifest.action.default_popup).toBe('index.html');
  });

  it('should pin the deterministic development public key matching DEVMIRROR_DEV_EXTENSION_KEY', () => {
    expect(manifest.key).toBe(DEVMIRROR_DEV_EXTENSION_KEY);

    // Compute deterministic extension ID from the key
    const derBuffer = Buffer.from(manifest.key, 'base64');
    const hash = crypto.createHash('sha256').update(derBuffer).digest();
    const computedId = Array.from(hash.subarray(0, 16))
      .map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 0x0f)))
      .join('');

    // Must match DEVMIRROR_DEV_EXTENSION_ID exactly
    expect(computedId).toBe(DEVMIRROR_DEV_EXTENSION_ID);
    expect(computedId).toBe('kmcaoghdokfdbadplofpkeabloldmoga');
  });

  it('should enforce principle of least privilege for permissions', () => {
    // Only storage is permitted for user preferences
    expect(manifest.permissions).toEqual(['storage']);

    // Must not request sensitive or unnecessary permissions
    expect(manifest.permissions).not.toContain('cookies');
    expect(manifest.permissions).not.toContain('webRequest');
    expect(manifest.permissions).not.toContain('tabs');
    expect(manifest.permissions).not.toContain('<all_urls>');
  });

  it('should restrict host permissions strictly to local agent loopback addresses', () => {
    expect(manifest.host_permissions).toEqual([
      'http://127.0.0.1/*',
      'http://localhost/*'
    ]);

    // Must never request public internet or wildcards
    expect(manifest.host_permissions).not.toContain('<all_urls>');
    expect(manifest.host_permissions).not.toContain('https://*/*');
    expect(manifest.host_permissions).not.toContain('http://*/*');
  });
});
