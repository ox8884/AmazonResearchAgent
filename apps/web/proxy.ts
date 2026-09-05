import { NextResponse, type NextRequest } from 'next/server';
import { isPublicAppPath, loginRedirectPath } from './lib/admin-route-guard';
import { getSessionSigningKey, sessionFromRequest } from './lib/admin-session-cookie';

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (isPublicAppPath(pathname)) {
    return NextResponse.next();
  }

  try {
    const session = sessionFromRequest(request, getSessionSigningKey());
    if (session) {
      return NextResponse.next();
    }
  } catch {
    // Missing or invalid signing configuration is treated as unauthenticated.
  }

  return NextResponse.redirect(new URL(loginRedirectPath(pathname), request.url));
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|_next/webpack-hmr|favicon.ico).*)']
};
