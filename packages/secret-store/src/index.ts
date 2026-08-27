import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;

export interface EncryptedSecret {
  readonly ciphertext: string;
  readonly iv: string;
  readonly authTag: string;
  readonly last4: string;
}

export class SecretStoreError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'SecretStoreError';
  }
}

function requireKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new SecretStoreError('Secret encryption key must be 32 bytes.');
  }
}

function decodeBase64(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 0 || decoded.toString('base64') !== value) {
    throw new SecretStoreError('Encrypted secret encoding is invalid.');
  }
  return decoded;
}

export function encryptSecret(
  plaintext: string,
  key: Buffer
): EncryptedSecret {
  requireKey(key);
  if (plaintext.length === 0) {
    throw new SecretStoreError('Secret plaintext must not be empty.');
  }

  try {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      last4: plaintext.slice(-4)
    };
  } catch (error) {
    throw new SecretStoreError('Unable to encrypt provider secret.', error);
  }
}

export function decryptSecret(
  secret: EncryptedSecret,
  key: Buffer
): string {
  requireKey(key);

  try {
    const iv = decodeBase64(secret.iv);
    const ciphertext = decodeBase64(secret.ciphertext);
    const authTag = decodeBase64(secret.authTag);
    if (iv.length !== IV_BYTES || authTag.length !== 16) {
      throw new SecretStoreError('Encrypted secret encoding is invalid.');
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString('utf8');
  } catch (error) {
    if (error instanceof SecretStoreError) {
      throw error;
    }
    throw new SecretStoreError('Unable to decrypt provider secret.', error);
  }
}

export function getEncryptionKeyFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): Buffer {
  const encoded = environment.APP_SECRET_ENCRYPTION_KEY_B64;
  if (!encoded) {
    throw new SecretStoreError('APP_SECRET_ENCRYPTION_KEY_B64 is required.');
  }

  const key = decodeBase64(encoded);
  requireKey(key);
  return key;
}
