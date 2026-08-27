import {
  adminSessionCookies,
  AdminAuthError,
  createAdminSession,
  getAdminPasswordVerifier,
  getSessionSigningKey,
  verifyAdminPassword
} from '../../../../lib/server/admin-session';
import { verifyRequestOrigin } from '../../../../lib/server/csrf';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

const LoginSchema = z.object({
  password: z.string().min(1).max(1024)
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    verifyRequestOrigin(request);
    const parsed = LoginSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
    }
    const valid = await verifyAdminPassword(
      parsed.data.password,
      getAdminPasswordVerifier()
    );
    if (!valid) {
      return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
    }
    const issued = createAdminSession(getSessionSigningKey());
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
      error instanceof AdminAuthError ||
      error instanceof SyntaxError ||
      error instanceof z.ZodError
    ) {
      return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
    }
    throw error;
  }
}
