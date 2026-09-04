import type { AdminSession, IssuedAdminSession } from './admin-session';
import { getServerDatabaseContext } from './database';

export class AdminSessionStoreError extends Error {
  constructor() {
    super('Admin session store is unavailable.');
    this.name = 'AdminSessionStoreError';
  }
}

export async function persistAdminSession(session: IssuedAdminSession): Promise<void> {
  const { client } = getServerDatabaseContext();
  const { error } = await client.from('admin_sessions').insert({
    id: session.sessionId,
    expires_at: session.expiresAt.toISOString()
  });
  if (error) {
    throw new AdminSessionStoreError();
  }
}

export async function isAdminSessionActive(session: AdminSession): Promise<boolean> {
  const { client } = getServerDatabaseContext();
  const { data, error } = await client
    .from('admin_sessions')
    .select('id')
    .eq('id', session.sessionId)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) {
    throw new AdminSessionStoreError();
  }
  return data !== null;
}

export async function revokeAdminSession(session: AdminSession): Promise<void> {
  const { client } = getServerDatabaseContext();
  const { error } = await client.from('admin_sessions').delete().eq('id', session.sessionId);
  if (error) {
    throw new AdminSessionStoreError();
  }
}
