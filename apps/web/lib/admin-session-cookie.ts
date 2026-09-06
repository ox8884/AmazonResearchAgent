import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_COOKIE = 'ara_admin_session';
const CSRF_COOKIE = 'ara_csrf';
const DEVICE_COOKIE = 'ara_admin_device';
const SESSION_KEY_BYTES = 32;
const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;
const DEVICE_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface AdminSession {
  readonly sessionId: string;
  readonly expiresAtSeconds: number;
  readonly csrfToken: string;
}

export interface IssuedAdminSession {
  readonly sessionId: string;
  readonly token: string;
  readonly csrfToken: string;
  readonly expiresAt: Date;
}

export class AdminAuthError extends Error {
  readonly status: 401 | 403;

  constructor(message: string, status: 401 | 403) {
    super(message);
    this.name = 'AdminAuthError';
    this.status = status;
  }
}

function sessionSignature(payload: string, key: Buffer): Buffer {
  return createHmac('sha256', key).update(payload).digest();
}

function parseSessionPayload(payload: string): AdminSession | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (
      typeof value !== 'object' ||
      value === null ||
      !('expiresAtSeconds' in value) ||
      !('csrfToken' in value) ||
      !('sessionId' in value) ||
      typeof value.expiresAtSeconds !== 'number' ||
      typeof value.csrfToken !== 'string' ||
      typeof value.sessionId !== 'string' ||
      value.sessionId.length < 32
    ) {
      return null;
    }
    return {
      sessionId: value.sessionId,
      expiresAtSeconds: value.expiresAtSeconds,
      csrfToken: value.csrfToken
    };
  } catch {
    return null;
  }
}

function requireSigningKey(key: Buffer): void {
  if (key.length !== SESSION_KEY_BYTES) {
    throw new AdminAuthError('Session signing key must be 32 bytes.', 401);
  }
}

export function createAdminSession(
  key: Buffer,
  now: Date = new Date(),
  ttlSeconds: number = SESSION_TTL_SECONDS
): IssuedAdminSession {
  requireSigningKey(key);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60) {
    throw new AdminAuthError('Session TTL is invalid.', 401);
  }
  const session: AdminSession = {
    sessionId: randomBytes(24).toString('base64url'),
    expiresAtSeconds: Math.floor(now.getTime() / 1000) + ttlSeconds,
    csrfToken: randomBytes(24).toString('base64url')
  };
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const signature = sessionSignature(payload, key).toString('base64url');
  return {
    sessionId: session.sessionId,
    token: `${payload}.${signature}`,
    csrfToken: session.csrfToken,
    expiresAt: new Date(session.expiresAtSeconds * 1000)
  };
}

export function verifyAdminSession(
  token: string,
  key: Buffer,
  now: Date = new Date()
): AdminSession | null {
  requireSigningKey(key);
  const [payload, encodedSignature, extra] = token.split('.');
  if (!payload || !encodedSignature || extra !== undefined) {
    return null;
  }
  const actualSignature = Buffer.from(encodedSignature, 'base64url');
  const expectedSignature = sessionSignature(payload, key);
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return null;
  }
  const session = parseSessionPayload(payload);
  if (!session || session.expiresAtSeconds <= Math.floor(now.getTime() / 1000)) {
    return null;
  }
  return session;
}

export function parseCookieHeader(cookieHeader: string | null): ReadonlyMap<string, string> {
  const cookies = new Map<string, string>();
  for (const entry of cookieHeader?.split(';') ?? []) {
    const separator = entry.indexOf('=');
    if (separator < 1) {
      continue;
    }
    let value: string;
    try {
      value = decodeURIComponent(entry.slice(separator + 1).trim());
    } catch {
      continue;
    }
    cookies.set(entry.slice(0, separator).trim(), value);
  }
  return cookies;
}

export function sessionFromRequest(
  request: Request,
  key: Buffer,
  now: Date = new Date()
): AdminSession | null {
  const token = parseCookieHeader(request.headers.get('cookie')).get(SESSION_COOKIE);
  return token ? verifyAdminSession(token, key, now) : null;
}

export function getSessionSigningKey(
  environment: NodeJS.ProcessEnv = process.env
): Buffer {
  const encoded = environment.APP_SESSION_SIGNING_KEY_B64;
  if (!encoded) {
    throw new AdminAuthError('APP_SESSION_SIGNING_KEY_B64 is required.', 401);
  }
  const key = Buffer.from(encoded, 'base64');
  requireSigningKey(key);
  return key;
}

export function requestUsesSecureCookies(request: Request): boolean {
  try {
    if (new URL(request.url).protocol === 'https:') {
      return true;
    }
  } catch {
    // Invalid request URLs fall back to NODE_ENV.
  }
  return process.env.NODE_ENV === 'production';
}

export function adminSessionCookies(
  issued: IssuedAdminSession,
  secure: boolean
): readonly string[] {
  const base = `Path=/; SameSite=Strict${secure ? '; Secure' : ''}`;
  const maxAge = Math.max(
    0,
    Math.floor((issued.expiresAt.getTime() - Date.now()) / 1000)
  );
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(issued.token)}; ${base}; HttpOnly; Max-Age=${maxAge}`,
    `${CSRF_COOKIE}=${encodeURIComponent(issued.csrfToken)}; ${base}; Max-Age=${maxAge}`
  ];
}

export function createTrustedDeviceToken(
  key: Buffer,
  now: Date = new Date(),
  ttlSeconds: number = DEVICE_TTL_SECONDS
): { readonly token: string; readonly expiresAt: Date } {
  requireSigningKey(key);
  const expiresAtSeconds = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      expiresAtSeconds,
      nonce: randomBytes(16).toString('base64url')
    })
  ).toString('base64url');
  return {
    token: `${payload}.${sessionSignature(payload, key).toString('base64url')}`,
    expiresAt: new Date(expiresAtSeconds * 1000)
  };
}

export function verifyTrustedDeviceToken(
  token: string,
  key: Buffer,
  now: Date = new Date()
): boolean {
  requireSigningKey(key);
  const [payload, encodedSignature, extra] = token.split('.');
  if (!payload || !encodedSignature || extra !== undefined) {
    return false;
  }
  const actualSignature = Buffer.from(encodedSignature, 'base64url');
  const expectedSignature = sessionSignature(payload, key);
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return false;
  }
  try {
    const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return (
      typeof value === 'object' &&
      value !== null &&
      'v' in value &&
      value.v === 1 &&
      'expiresAtSeconds' in value &&
      typeof value.expiresAtSeconds === 'number' &&
      value.expiresAtSeconds > Math.floor(now.getTime() / 1000)
    );
  } catch {
    return false;
  }
}

export function trustedDeviceFromRequest(
  request: Request,
  key: Buffer,
  now: Date = new Date()
): boolean {
  const token = parseCookieHeader(request.headers.get('cookie')).get(DEVICE_COOKIE);
  return token ? verifyTrustedDeviceToken(token, key, now) : false;
}

export function trustedDeviceCookie(
  token: string,
  expiresAt: Date,
  secure: boolean
): string {
  const base = `Path=/; SameSite=Strict${secure ? '; Secure' : ''}`;
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return `${DEVICE_COOKIE}=${encodeURIComponent(token)}; ${base}; HttpOnly; Max-Age=${maxAge}`;
}

export function clearedAdminCookies(secure: boolean): readonly string[] {
  const base = `Path=/; SameSite=Strict${secure ? '; Secure' : ''}; Max-Age=0`;
  return [
    `${SESSION_COOKIE}=; ${base}; HttpOnly`,
    `${CSRF_COOKIE}=; ${base}`
  ];
}

export const AdminCookieNames = {
  session: SESSION_COOKIE,
  csrf: CSRF_COOKIE,
  device: DEVICE_COOKIE
} as const;
