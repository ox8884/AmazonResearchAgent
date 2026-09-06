import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { AdminAuthError } from '../admin-session-cookie';

export {
  AdminAuthError,
  AdminCookieNames,
  adminSessionCookies,
  clearedAdminCookies,
  createAdminSession,
  createTrustedDeviceToken,
  getSessionSigningKey,
  parseCookieHeader,
  requestUsesSecureCookies,
  sessionFromRequest,
  trustedDeviceCookie,
  trustedDeviceFromRequest,
  verifyAdminSession,
  verifyTrustedDeviceToken,
  type AdminSession,
  type IssuedAdminSession
} from '../admin-session-cookie';

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const PASSWORD_KEY_BYTES = 32;

function scryptPassword(
  password: string,
  salt: Buffer,
  parameters: { readonly n: number; readonly r: number; readonly p: number }
): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  scrypt(
    password,
    salt,
    PASSWORD_KEY_BYTES,
    {
      N: parameters.n,
      r: parameters.r,
      p: parameters.p,
      maxmem: 64 * 1024 * 1024
    },
    (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    }
  );
  return promise;
}

function parseVerifier(verifier: string) {
  const [algorithm, n, r, p, salt, hash] = verifier.split('$');
  if (
    algorithm !== 'scrypt' ||
    !n ||
    !r ||
    !p ||
    !salt ||
    !hash ||
    !Number.isSafeInteger(Number(n)) ||
    !Number.isSafeInteger(Number(r)) ||
    !Number.isSafeInteger(Number(p))
  ) {
    throw new AdminAuthError('Admin password verifier is invalid.', 401);
  }
  const saltBuffer = Buffer.from(salt, 'base64');
  const hashBuffer = Buffer.from(hash, 'base64');
  if (saltBuffer.length < 16 || hashBuffer.length !== PASSWORD_KEY_BYTES) {
    throw new AdminAuthError('Admin password verifier is invalid.', 401);
  }
  return {
    n: Number(n),
    r: Number(r),
    p: Number(p),
    salt: saltBuffer,
    hash: hashBuffer
  };
}

export async function hashAdminPassword(
  password: string,
  salt: Buffer = randomBytes(16)
): Promise<string> {
  if (password.length < 12 || salt.length < 16) {
    throw new AdminAuthError('Admin password or salt is too short.', 401);
  }
  const hash = await scryptPassword(password, salt, {
    n: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    hash.toString('base64')
  ].join('$');
}

export async function verifyAdminPassword(
  password: string,
  verifier: string
): Promise<boolean> {
  const parsed = parseVerifier(verifier);
  const actual = await scryptPassword(password, parsed.salt, parsed);
  return timingSafeEqual(actual, parsed.hash);
}

export function getAdminPasswordVerifier(
  environment: NodeJS.ProcessEnv = process.env
): string {
  const verifier = environment.ADMIN_PASSWORD_SCRYPT;
  if (!verifier) {
    throw new AdminAuthError('ADMIN_PASSWORD_SCRYPT is required.', 401);
  }
  return verifier;
}
