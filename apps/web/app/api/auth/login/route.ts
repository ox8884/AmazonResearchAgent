import {
  adminSessionCookies,
  AdminAuthError,
  createAdminSession,
  getAdminPasswordVerifier,
  getSessionSigningKey,
  verifyAdminPassword
} from '../../../../lib/server/admin-session';
import { verifyRequestOrigin } from '../../../../lib/server/csrf';
import { AbuseGuardError } from '../../../../lib/server/abuse-guard';
import {
  consumeDurableLoginAttempt,
  withDurableLoginScrypt
} from '../../../../lib/server/login-guard';
import { ServerConfigurationError } from '../../../../lib/server/database';
import {
  AdminSessionStoreError,
  persistAdminSession
} from '../../../../lib/server/admin-session-store';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

const LoginSchema = z.object({
  password: z.string().min(1).max(1024)
});

function invalidCredentials(): NextResponse {
  return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    verifyRequestOrigin(request);
    await consumeDurableLoginAttempt();
    const parsed = LoginSchema.safeParse(await request.json());
    if (!parsed.success) {
      return invalidCredentials();
    }
    const valid = await withDurableLoginScrypt(() =>
      verifyAdminPassword(parsed.data.password, getAdminPasswordVerifier())
    );
    if (!valid) {
      return invalidCredentials();
    }
    const issued = createAdminSession(getSessionSigningKey());
    await persistAdminSession(issued);
    const response = NextResponse.json({ authenticated: true });
    for (const cookie of adminSessionCookies(
      issued,
      process.env.NODE_ENV === 'production'
    )) {
      response.headers.append('set-cookie', cookie);
    }
    return response;
  } catch (error) {
    if (
      error instanceof AbuseGuardError ||
      error instanceof AdminAuthError ||
      error instanceof ServerConfigurationError ||
      error instanceof AdminSessionStoreError ||
      error instanceof SyntaxError ||
      error instanceof z.ZodError
    ) {
      return invalidCredentials();
    }
    throw error;
  }
}
