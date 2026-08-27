import { scryptSync } from 'node:crypto';

export const E2E_ADMIN_PASSWORD = 'e2e-admin-test-password';

const passwordSalt = Buffer.alloc(16, 9);
const passwordHash = scryptSync(E2E_ADMIN_PASSWORD, passwordSalt, 32, {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
});

export const E2E_ADMIN_PASSWORD_SCRYPT = [
  'scrypt',
  '16384',
  '8',
  '1',
  passwordSalt.toString('base64'),
  passwordHash.toString('base64')
].join('$');

export const E2E_SESSION_SIGNING_KEY_B64 = Buffer.alloc(32, 5).toString('base64');
export const E2E_SECRET_ENCRYPTION_KEY_B64 = Buffer.alloc(32, 7).toString('base64');

export const e2eAdminEnvironment = {
  ADMIN_PASSWORD_SCRYPT: E2E_ADMIN_PASSWORD_SCRYPT,
  APP_SESSION_SIGNING_KEY_B64: E2E_SESSION_SIGNING_KEY_B64,
  APP_SECRET_ENCRYPTION_KEY_B64: E2E_SECRET_ENCRYPTION_KEY_B64
} as const;
