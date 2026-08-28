import { randomUUID } from 'node:crypto';
import { getServerDatabaseContext } from './database';
import { AbuseGuardError } from './abuse-guard';

const MAX_ATTEMPTS = 8;
const WINDOW_SECONDS = 5 * 60;
const SCRYPT_LEASE_SECONDS = 30;

export async function consumeDurableLoginAttempt(): Promise<void> {
  const { client } = getServerDatabaseContext();
  const { data, error } = await client.rpc('consume_admin_login_attempt', {
    max_attempts: MAX_ATTEMPTS,
    window_seconds: WINDOW_SECONDS
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
