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

export function parseAdminAllowedIps(
  value: string | undefined
): readonly string[] {
  if (value === undefined) {
    return [];
  }
  const allowed: string[] = [];
  for (const entry of value.split(',')) {
    const canonical = canonicalClientIp(entry.trim());
    if (canonical) {
      allowed.push(canonical);
    }
  }
  return allowed;
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
  if (!allowed.includes(clientIp)) {
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
