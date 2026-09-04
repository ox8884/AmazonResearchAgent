import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  AdminCookieNames,
  getSessionSigningKey,
  verifyAdminSession
} from './admin-session';
import { isAdminSessionActive } from './admin-session-store';

export async function requireAdminPage(locale: 'ko' | 'en'): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AdminCookieNames.session)?.value;
  let authenticated = false;
  try {
    if (token) {
      const session = verifyAdminSession(token, getSessionSigningKey());
      authenticated = session !== null && await isAdminSessionActive(session);
    }
  } catch {
    authenticated = false;
  }
  if (authenticated) return;
  redirect(`/${locale}/login`);
}
