import { createHmac, timingSafeEqual } from 'node:crypto';
import { AdminAuthError } from './admin-session';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1;

function decodeBase32(value: string): Buffer {
  const cleaned = value.toUpperCase().replace(/=+$/u, '').replace(/\s+/gu, '');
  if (cleaned.length === 0 || /[^A-Z2-7]/u.test(cleaned)) {
    throw new AdminAuthError('Admin TOTP secret is invalid.', 401);
  }
  let bits = '';
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  if (bytes.length === 0) {
    throw new AdminAuthError('Admin TOTP secret is invalid.', 401);
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const payload = Buffer.alloc(8);
  payload.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  payload.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac('sha1', secret).update(payload).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    ((digest[offset] ?? 0) & 0x7f) << 24 |
    ((digest[offset + 1] ?? 0) & 0xff) << 16 |
    ((digest[offset + 2] ?? 0) & 0xff) << 8 |
    ((digest[offset + 3] ?? 0) & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function configuredAdminTotpSecret(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string | undefined {
  const secret = environment.ADMIN_TOTP_SECRET_BASE32?.trim();
  return secret && secret.length > 0 ? secret : undefined;
}

export function verifyAdminTotp(
  secretBase32: string,
  code: string | undefined,
  now: Date = new Date()
): boolean {
  if (code === undefined || !/^\d{6}$/u.test(code)) {
    return false;
  }
  const secret = decodeBase32(secretBase32);
  const step = Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
  const presented = Buffer.from(code);
  let matched = false;
  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset += 1) {
    const expected = Buffer.from(hotp(secret, step + offset));
    if (timingSafeEqual(presented, expected)) {
      matched = true;
    }
  }
  return matched;
}
