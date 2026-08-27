import {
  AdminAuthError,
  clearedAdminCookies,
  getSessionSigningKey
} from '../../../../lib/server/admin-session';
import { verifyCsrfRequest } from '../../../../lib/server/csrf';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    verifyCsrfRequest(request, getSessionSigningKey());
    const response = NextResponse.json({ authenticated: false });
    for (const cookie of clearedAdminCookies(process.env.NODE_ENV === 'production')) {
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
