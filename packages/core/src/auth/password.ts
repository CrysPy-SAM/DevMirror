/**
 * @devmirror/core - Password Authentication Manager
 * Secure salted scrypt hashing, constant-time verification, and brute-force rate-limiting.
 */

import crypto from 'node:crypto';

export interface PasswordVerificationResult {
  success: boolean;
  error?: string;
  lockedOut?: boolean;
  retryAfterSeconds?: number;
}

export interface PasswordAuthOptions {
  customPassword?: string;
  maxAttempts?: number;
  lockoutDurationMs?: number;
  attemptWindowMs?: number;
}

interface AttemptRecord {
  count: number;
  firstAttemptAt: number;
  lockedUntil?: number;
}

export class PasswordAuthManager {
  private readonly salt: string;
  private readonly passwordHash: string;
  private initialPassword: string | null = null;
  private readonly maxAttempts: number;
  private readonly lockoutDurationMs: number;
  private readonly attemptWindowMs: number;
  private readonly attemptsByIp: Map<string, AttemptRecord> = new Map();

  constructor(options: PasswordAuthOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.lockoutDurationMs = options.lockoutDurationMs ?? 60 * 1000; // 1 minute lockout
    this.attemptWindowMs = options.attemptWindowMs ?? 5 * 60 * 1000; // 5 minute window

    const plaintextPassword = options.customPassword && options.customPassword.trim().length > 0
      ? options.customPassword.trim()
      : PasswordAuthManager.generateReadablePassword();

    // Store initial password once for CLI display
    this.initialPassword = plaintextPassword;

    // Generate random cryptographic salt
    this.salt = crypto.randomBytes(16).toString('hex');

    // Hash password with scrypt (N=16384, r=8, p=1, keylen=32)
    this.passwordHash = PasswordAuthManager.hashPassword(plaintextPassword, this.salt);
  }

  /**
   * Generates a mobile-friendly 8-character alphanumeric password.
   * Format: 'dm-' + 5 alphanumeric characters (e.g. 'dm-7k2p9')
   */
  public static generateReadablePassword(): string {
    const chars = '23456789abcdefghjkmnpqrstuvwxyz'; // removed easily confused characters: 0, 1, i, l, o
    let suffix = '';
    const bytes = crypto.randomBytes(5);
    for (let i = 0; i < 5; i++) {
      suffix += chars[bytes[i] % chars.length];
    }
    return `dm-${suffix}`;
  }

  /**
   * Computes scrypt key derivation.
   */
  private static hashPassword(password: string, salt: string): string {
    const key = crypto.scryptSync(password.normalize('NFKC'), salt, 32);
    return key.toString('hex');
  }

  /**
   * Returns the initial plaintext password for CLI display.
   * Can be retrieved for developer output, but the class does not rely on it for verification.
   */
  public getInitialPassword(): string {
    return this.initialPassword ?? '[Configured Password]';
  }

  /**
   * Clears the plaintext password from memory after initial CLI display.
   */
  public purgeInitialPassword(): void {
    this.initialPassword = null;
  }

  /**
   * Verifies an input password with constant-time equality check and brute-force throttling.
   */
  public verify(inputPassword: string | undefined | null, clientIp: string = 'unknown'): PasswordVerificationResult {
    const now = Date.now();
    const record = this.attemptsByIp.get(clientIp);

    // 1. Check if client is currently locked out
    if (record && record.lockedUntil && record.lockedUntil > now) {
      const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
      return {
        success: false,
        lockedOut: true,
        retryAfterSeconds: remainingSeconds,
        error: `Too many failed attempts. Locked out for ${remainingSeconds}s.`
      };
    }

    if (!inputPassword || typeof inputPassword !== 'string') {
      return { success: false, error: 'Password is required' };
    }

    // 2. Hash input password with stored salt
    const inputHash = PasswordAuthManager.hashPassword(inputPassword, this.salt);

    // 3. Constant-time comparison
    const inputBuf = Buffer.from(inputHash, 'hex');
    const storedBuf = Buffer.from(this.passwordHash, 'hex');

    const isMatch = inputBuf.length === storedBuf.length && crypto.timingSafeEqual(inputBuf, storedBuf);

    if (isMatch) {
      // Clear failed attempts on success
      this.attemptsByIp.delete(clientIp);
      return { success: true };
    }

    // 4. Record failed attempt
    if (!record || now - record.firstAttemptAt > this.attemptWindowMs) {
      this.attemptsByIp.set(clientIp, { count: 1, firstAttemptAt: now });
    } else {
      record.count += 1;
      if (record.count >= this.maxAttempts) {
        record.lockedUntil = now + this.lockoutDurationMs;
        const remainingSeconds = Math.ceil(this.lockoutDurationMs / 1000);
        return {
          success: false,
          lockedOut: true,
          retryAfterSeconds: remainingSeconds,
          error: `Too many failed attempts. Locked out for ${remainingSeconds}s.`
        };
      }
    }

    return { success: false, error: 'Invalid password. Please try again.' };
  }

  /**
   * Cleans up expired rate-limiting records.
   */
  public cleanupExpiredAttempts(): void {
    const now = Date.now();
    for (const [ip, record] of this.attemptsByIp.entries()) {
      if ((!record.lockedUntil || record.lockedUntil < now) && now - record.firstAttemptAt > this.attemptWindowMs) {
        this.attemptsByIp.delete(ip);
      }
    }
  }
}
