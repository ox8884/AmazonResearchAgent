import {
  AdminAuthError,
  AdminCookieNames,
  parseCookieHeader,
  sessionFromRequest,
  type AdminSession
} from './admin-session';

function requestHost(request: Request): string | null {
  return (
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ??
    request.headers.get('host')
  );
}

export function verifyRequestOrigin(request: Request): void {
  const originHeader = request.headers.get('origin');
  const host = requestHost(request);
  if (!originHeader || !host) {
    throw new AdminAuthError('Request origin is required.', 403);
  }
  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    throw new AdminAuthError('Request origin is invalid.', 403);
  }
  if (origin.host !== host || origin.protocol !== new URL(request.url).protocol) {
    throw new AdminAuthError('Request origin is not allowed.', 403);
  }
}

export function verifyCsrfRequest(
  request: Request,
  signingKey: Buffer,
  now: Date = new Date()
): AdminSession {
  verifyRequestOrigin(request);
  const session = sessionFromRequest(request, signingKey, now);
  if (!session) {
    throw new AdminAuthError('Admin session is required.', 401);
  }
  const cookies = parseCookieHeader(request.headers.get('cookie'));
  const cookieToken = cookies.get(AdminCookieNames.csrf);
  const headerToken = request.headers.get('x-csrf-token');
  if (
    !cookieToken ||
    !headerToken ||
    cookieToken !== session.csrfToken ||
    headerToken !== session.csrfToken
  ) {
    throw new AdminAuthError('CSRF validation failed.', 403);
  }
  return session;
}
