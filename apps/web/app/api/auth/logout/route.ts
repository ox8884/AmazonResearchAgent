import {
  AdminAuthError,
  clearedAdminCookies,
  requestUsesSecureCookies
} from '../../../../lib/server/admin-session';
import { requireAdminMutation } from '../../../../lib/server/api-auth';
import { revokeAdminSession } from '../../../../lib/server/admin-session-store';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const session = await requireAdminMutation(request);
    await revokeAdminSession(session);
    const response = NextResponse.json({ authenticated: false });
    for (const cookie of clearedAdminCookies(requestUsesSecureCookies(request))) {
      response.headers.append('set-cookie', cookie);
    }
    return response;
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json(
        { error: error.status === 401 ? 'authentication_required' : 'csrf_failed' },
        { status: error.status }
      );
    }
    throw error;
  }
}
