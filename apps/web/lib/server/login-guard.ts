import { createHmac, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { AdminAuthError, getSessionSigningKey } from './admin-session';
import { getServerDatabaseContext } from './database';
import { AbuseGuardError } from './abuse-guard';

const PER_CLIENT_MAX_ATTEMPTS = 8;
const GLOBAL_MAX_ATTEMPTS = 80;
const WINDOW_SECONDS = 5 * 60;
const SCRYPT_LEASE_SECONDS = 30;
const IMPORT_MAX_ATTEMPTS = 10;
const IMPORT_WINDOW_SECONDS = 60;
const CLOUDFLARE_CLIENT_IP_HEADER = 'cf-connecting-ip';

export function canonicalClientIp(value: string): string | undefined {
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return undefined;
  return new URL(`http://[${value}]/`).hostname.slice(1, -1);
}

function clientIdentityHash(value: string): string {
  return createHmac('sha256', getSessionSigningKey())
    .update(`ara-login-client-v1\u0000${value}`)
    .digest('hex');
}

function actionSubjectHash(value: string): string {
  return createHmac('sha256', getSessionSigningKey())
    .update(`ara-action-subject-v1\u0000${value}`)
    .digest('hex');
}

export function trustedCloudflareClientIp(request: Request): string | undefined {
  if (process.env.ARA_TRUST_CLOUDFLARE_CLIENT_IP !== 'true') {
    return undefined;
  }
  const clientIp = request.headers.get(CLOUDFLARE_CLIENT_IP_HEADER);
  if (clientIp === null) return undefined;
  return canonicalClientIp(clientIp);
}

export function trustedCloudflareClientIdentityHash(request: Request): string | undefined {
  const canonicalIp = trustedCloudflareClientIp(request);
  return canonicalIp === undefined ? undefined : clientIdentityHash(canonicalIp);
}

function ipv4ToInt(value: string): number | undefined {
  if (isIP(value) !== 4) {
    return undefined;
  }
  const parts = value.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return undefined;
  }
  return ((parts[0] ?? 0) << 24 >>> 0) + ((parts[1] ?? 0) << 16) + ((parts[2] ?? 0) << 8) + (parts[3] ?? 0);
}

function ipv6ToBytes(value: string): Uint8Array | undefined {
  const canonical = canonicalClientIp(value);
  if (canonical === undefined || isIP(canonical) !== 6) {
    return undefined;
  }
  const halves = canonical.split('::');
  if (halves.length > 2) {
    return undefined;
  }
  const parsePart = (part: string | undefined): number[] => {
    if (part === undefined || part.length === 0) {
      return [];
    }
    return part.split(':').map((group) => Number.parseInt(group, 16));
  };
  const head = parsePart(halves[0]);
  const tail = halves.length === 2 ? parsePart(halves[1]) : [];
  if (head.some((group) => !Number.isInteger(group)) || tail.some((group) => !Number.isInteger(group))) {
    return undefined;
  }
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) {
    return undefined;
  }
  const groups = halves.length === 2 ? [...head, ...Array.from({ length: missing }, () => 0), ...tail] : head;
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = group >> 8;
    bytes[index * 2 + 1] = group & 0xff;
  });
  return bytes;
}

function cidrContains(cidr: string, ip: string): boolean {
  const slash = cidr.lastIndexOf('/');
  if (slash < 1) {
    return false;
  }
  const base = cidr.slice(0, slash);
  const prefix = Number(cidr.slice(slash + 1));
  if (!Number.isInteger(prefix)) {
    return false;
  }
  const ip4 = ipv4ToInt(ip);
  const base4 = ipv4ToInt(base);
  if (ip4 !== undefined && base4 !== undefined) {
    if (prefix < 0 || prefix > 32) {
      return false;
    }
    const mask = prefix === 0 ? 0 : (0xffff_ffff << (32 - prefix)) >>> 0;
    return (ip4 & mask) === (base4 & mask);
  }
  const ip6 = ipv6ToBytes(ip);
  const base6 = ipv6ToBytes(base);
  if (ip6 === undefined || base6 === undefined || prefix < 0 || prefix > 128) {
    return false;
  }
  const fullBytes = Math.floor(prefix / 8);
  const rem = prefix % 8;
  for (let index = 0; index < fullBytes; index += 1) {
    if (ip6[index] !== base6[index]) {
      return false;
    }
  }
  if (rem === 0) {
    return true;
  }
  const mask = (0xff << (8 - rem)) & 0xff;
  return ((ip6[fullBytes] ?? 0) & mask) === ((base6[fullBytes] ?? 0) & mask);
}

export function parseAdminAllowedIps(
  value: string | undefined
): readonly string[] {
  if (value === undefined) {
    return [];
  }
  const allowed: string[] = [];
  for (const raw of value.split(',')) {
    const entry = raw.trim();
    if (entry.includes('/')) {
      const slash = entry.lastIndexOf('/');
      const base = entry.slice(0, slash);
      const prefix = Number(entry.slice(slash + 1));
      if (canonicalClientIp(base) !== undefined && Number.isInteger(prefix)) {
        allowed.push(entry);
      }
      continue;
    }
    const canonical = canonicalClientIp(entry);
    if (canonical) {
      allowed.push(canonical);
    }
  }
  return allowed;
}

export function ipIsAllowed(ip: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) => entry.includes('/') ? cidrContains(entry, ip) : entry === ip);
}

export function assertAdminClientAllowed(request: Request): void {
  const allowed = parseAdminAllowedIps(process.env.ARA_ADMIN_ALLOWED_IPS);
  if (allowed.length === 0) {
    return;
  }
  const clientIp = trustedCloudflareClientIp(request);
  if (clientIp === undefined) {
    if (process.env.NODE_ENV === 'production') {
      throw new AdminAuthError('Admin session is required.', 401);
    }
    return;
  }
  if (!ipIsAllowed(clientIp, allowed)) {
    throw new AdminAuthError('Admin session is required.', 401);
  }
}

export async function consumeDurableLoginAttempt(
  trustedClientIdentityHash: string | undefined
): Promise<void> {
  if (trustedClientIdentityHash === undefined && process.env.NODE_ENV === 'production') {
    throw new AbuseGuardError();
  }
  const { client } = getServerDatabaseContext();
  const { data, error } = await client.rpc('consume_admin_login_attempt', {
    client_identity_hash: trustedClientIdentityHash ?? clientIdentityHash('untrusted-local-origin'),
    per_client_max_attempts: PER_CLIENT_MAX_ATTEMPTS,
    global_max_attempts: GLOBAL_MAX_ATTEMPTS,
    window_seconds: WINDOW_SECONDS
  });
  if (error || data !== true) {
    throw new AbuseGuardError();
  }
}

export async function consumeDurableImportAttempt(sessionId: string): Promise<void> {
  const { client } = getServerDatabaseContext();
  const { data, error } = await client.rpc('consume_admin_action_attempt', {
    action_name: 'import',
    subject_hash: actionSubjectHash(sessionId),
    max_attempts: IMPORT_MAX_ATTEMPTS,
    window_seconds: IMPORT_WINDOW_SECONDS
  });
  if (error || data !== true) {
    throw new AbuseGuardError();
  }
}

export async function withDurableLoginScrypt<T>(
  work: () => Promise<T>
): Promise<T> {
  const { client } = getServerDatabaseContext();
  const lockOwner = randomUUID();
  const acquired = await client.rpc('acquire_admin_login_scrypt', {
    lock_owner: lockOwner,
    lease_seconds: SCRYPT_LEASE_SECONDS
  });
  if (acquired.error || acquired.data !== true) {
    throw new AbuseGuardError('Too many concurrent requests.');
  }
  try {
    return await work();
  } finally {
    const released = await client.rpc('release_admin_login_scrypt', {
      lock_owner: lockOwner
    });
    void released;
  }
}
