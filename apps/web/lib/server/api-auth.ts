import {
  AdminAuthError,
  getSessionSigningKey,
  sessionFromRequest,
  type AdminSession
} from './admin-session';
import { verifyCsrfRequest } from './csrf';
import { isAdminSessionActive } from './admin-session-store';
import { NextResponse } from 'next/server';

export async function requireAdminRead(request: Request): Promise<AdminSession> {
  const session = sessionFromRequest(request, getSessionSigningKey());
  if (!session || !(await isAdminSessionActive(session))) {
    throw new AdminAuthError('Admin session is required.', 401);
  }
  return session;
}

export async function requireAdminMutation(request: Request): Promise<AdminSession> {
  const session = verifyCsrfRequest(request, getSessionSigningKey());
  if (!(await isAdminSessionActive(session))) {
    throw new AdminAuthError('Admin session is required.', 401);
  }
  return session;
}

export function adminAuthErrorResponse(error: AdminAuthError): NextResponse {
  return NextResponse.json(
    {
      error: error.status === 401 ? 'authentication_required' : 'csrf_failed'
    },
    { status: error.status }
  );
}
