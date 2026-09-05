import {
  adminSessionCookies,
  AdminAuthError,
  createAdminSession,
  getAdminPasswordVerifier,
  getSessionSigningKey,
  requestUsesSecureCookies,
  verifyAdminPassword
} from '../../../../lib/server/admin-session';
import { verifyRequestOrigin } from '../../../../lib/server/csrf';
import { AbuseGuardError } from '../../../../lib/server/abuse-guard';
import {
  assertAdminClientAllowed,
  consumeDurableLoginAttempt,
  trustedCloudflareClientIdentityHash,
  withDurableLoginScrypt
} from '../../../../lib/server/login-guard';
import {
  configuredAdminTotpSecret,
  verifyAdminTotp
} from '../../../../lib/server/admin-totp';
import { ServerConfigurationError } from '../../../../lib/server/database';
import {
  AdminSessionStoreError,
  persistAdminSession
} from '../../../../lib/server/admin-session-store';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

const LoginSchema = z.object({
  password: z.string().min(1).max(1024),
  totp: z.string().max(16).optional()
});

function invalidCredentials(): NextResponse {
  return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    verifyRequestOrigin(request);
    assertAdminClientAllowed(request);
    const clientIdentityHash = trustedCloudflareClientIdentityHash(request);
    if (clientIdentityHash === undefined && process.env.NODE_ENV === 'production') {
      throw new AbuseGuardError();
    }
    await consumeDurableLoginAttempt(clientIdentityHash);
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
    const totpSecret = configuredAdminTotpSecret();
    if (totpSecret && !verifyAdminTotp(totpSecret, parsed.data.totp)) {
      return invalidCredentials();
    }
    const issued = createAdminSession(getSessionSigningKey());
    await persistAdminSession(issued);
    const response = NextResponse.json({ authenticated: true });
    for (const cookie of adminSessionCookies(
      issued,
      requestUsesSecureCookies(request)
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
