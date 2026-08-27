import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  getEncryptionKeyFromEnvironment
} from './index';

describe('encrypted provider secret store', () => {
  it('round trips with AES-256-GCM and exposes only the last four characters', () => {
    const encrypted = encryptSecret('super-secret-value', Buffer.alloc(32, 7));

    expect(decryptSecret(encrypted, Buffer.alloc(32, 7))).toBe('super-secret-value');
    expect(encrypted.ciphertext).not.toContain('super-secret-value');
    expect(encrypted.last4).toBe('alue');
    expect(Buffer.from(encrypted.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(encrypted.authTag, 'base64')).toHaveLength(16);
  });

  it('rejects tampered ciphertext and the wrong key without exposing secret material', () => {
    const encrypted = encryptSecret('super-secret-value', Buffer.alloc(32, 7));
    const tampered = {
      ...encrypted,
      ciphertext: `${encrypted.ciphertext.slice(0, -2)}aa`
    };

    expect(() => decryptSecret(tampered, Buffer.alloc(32, 7))).toThrow();
    expect(() => decryptSecret(encrypted, Buffer.alloc(32, 8))).toThrow();
    expect(() => decryptSecret(tampered, Buffer.alloc(32, 7))).toThrowError(
      expect.not.objectContaining({ message: expect.stringContaining('super-secret-value') })
    );
  });

  it('requires a 32-byte key and decodes the configured base64 key', () => {
    expect(() => encryptSecret('secret', Buffer.alloc(31))).toThrow();
    expect(getEncryptionKeyFromEnvironment({
      APP_SECRET_ENCRYPTION_KEY_B64: Buffer.alloc(32, 3).toString('base64')
    })).toEqual(Buffer.alloc(32, 3));
    expect(() => getEncryptionKeyFromEnvironment({})).toThrow();
  });
});
