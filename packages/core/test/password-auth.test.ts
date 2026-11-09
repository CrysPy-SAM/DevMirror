import { describe, it, expect } from 'vitest';
import { PasswordAuthManager } from '../src/auth/password.js';
import { renderPublicAuthPage } from '../src/auth/template.js';

describe('PasswordAuthManager', () => {
  it('should auto-generate a secure readable password', () => {
    const auth = new PasswordAuthManager();
    const pwd = auth.getInitialPassword();
    expect(pwd).toBeDefined();
    expect(pwd.startsWith('dm-')).toBe(true);
    expect(pwd.length).toBe(8); // 'dm-' + 5 chars
  });

  it('should accept a custom password', () => {
    const auth = new PasswordAuthManager({ customPassword: 'custom-secret-123' });
    expect(auth.getInitialPassword()).toBe('custom-secret-123');
  });

  it('should successfully verify the correct password and reject incorrect password', () => {
    const auth = new PasswordAuthManager({ customPassword: 'correct-password' });

    // Wrong password
    const wrongRes = auth.verify('wrong-password', '192.168.1.100');
    expect(wrongRes.success).toBe(false);
    expect(wrongRes.error).toContain('Invalid password');

    // Correct password
    const correctRes = auth.verify('correct-password', '192.168.1.100');
    expect(correctRes.success).toBe(true);
    expect(correctRes.error).toBeUndefined();
  });

  it('should enforce brute-force lockout after maximum failed attempts', () => {
    const auth = new PasswordAuthManager({
      customPassword: 'my-password',
      maxAttempts: 3,
      lockoutDurationMs: 30000
    });

    const ip = '10.0.0.55';

    // 1st attempt
    expect(auth.verify('wrong', ip).success).toBe(false);
    // 2nd attempt
    expect(auth.verify('wrong', ip).success).toBe(false);
    // 3rd attempt -> triggers lockout
    const lockRes = auth.verify('wrong', ip);
    expect(lockRes.success).toBe(false);
    expect(lockRes.lockedOut).toBe(true);
    expect(lockRes.retryAfterSeconds).toBeGreaterThan(0);

    // Subsequent attempt while locked out is rejected even if correct password is provided
    const blockedRes = auth.verify('my-password', ip);
    expect(blockedRes.success).toBe(false);
    expect(blockedRes.lockedOut).toBe(true);
    expect(blockedRes.error).toContain('Too many failed attempts');
  });

  it('should isolate lockout between different client IPs', () => {
    const auth = new PasswordAuthManager({
      customPassword: 'shared-password',
      maxAttempts: 2
    });

    const ipA = '1.1.1.1';
    const ipB = '2.2.2.2';

    // IP A fails twice -> locked out
    auth.verify('bad', ipA);
    const lockA = auth.verify('bad', ipA);
    expect(lockA.lockedOut).toBe(true);

    // IP B can still successfully authenticate
    const resB = auth.verify('shared-password', ipB);
    expect(resB.success).toBe(true);
  });

  it('should allow clearing the plaintext password from memory', () => {
    const auth = new PasswordAuthManager({ customPassword: 'ephemeral-pwd' });
    expect(auth.getInitialPassword()).toBe('ephemeral-pwd');
    auth.purgeInitialPassword();
    expect(auth.getInitialPassword()).toBe('[Configured Password]');
    // Verification still works via scrypt hash
    expect(auth.verify('ephemeral-pwd', '127.0.0.1').success).toBe(true);
  });
});

describe('renderPublicAuthPage', () => {
  it('should render HTML with title, form, and action endpoint', () => {
    const html = renderPublicAuthPage({ projectName: 'My Awesome App' });
    expect(html).toContain('My Awesome App');
    expect(html).toContain('action="/__devmirror/auth"');
    expect(html).toContain('type="password"');
  });

  it('should render error banner when errorMessage is provided', () => {
    const html = renderPublicAuthPage({ errorMessage: 'Invalid password. Please try again.' });
    expect(html).toContain('error-banner');
    expect(html).toContain('Invalid password. Please try again.');
  });

  it('should disable form controls when locked out', () => {
    const html = renderPublicAuthPage({
      errorMessage: 'Too many failed attempts',
      isLockedOut: true
    });
    expect(html).toContain('disabled');
  });
});
