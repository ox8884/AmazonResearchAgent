import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  AdminCookieNames,
  getSessionSigningKey,
  verifyAdminSession
} from './admin-session';
import { isAdminSessionActive } from './admin-session-store';
import { assertAdminClientAllowed } from './login-guard';

export async function requireAdminPage(locale: 'ko' | 'en'): Promise<void> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const token = cookieStore.get(AdminCookieNames.session)?.value;
  let authenticated = false;
  try {
    const requestHeaders = new Headers();
    const clientIp = headerStore.get('cf-connecting-ip');
    if (clientIp) {
      requestHeaders.set('cf-connecting-ip', clientIp);
    }
    assertAdminClientAllowed(new Request('https://ara.invalid/', { headers: requestHeaders }));
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
