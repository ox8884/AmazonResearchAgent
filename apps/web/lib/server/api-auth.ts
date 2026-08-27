import {
  AdminAuthError,
  getSessionSigningKey,
  sessionFromRequest,
  type AdminSession
} from './admin-session';
import { verifyCsrfRequest } from './csrf';
import { NextResponse } from 'next/server';

export function requireAdminRead(request: Request): AdminSession {
  const session = sessionFromRequest(request, getSessionSigningKey());
  if (!session) {
    throw new AdminAuthError('Admin session is required.', 401);
  }
  return session;
}

export function requireAdminMutation(request: Request): AdminSession {
  return verifyCsrfRequest(request, getSessionSigningKey());
}

export function adminAuthErrorResponse(error: AdminAuthError): NextResponse {
  return NextResponse.json(
    {
      error: error.status === 401 ? 'authentication_required' : 'csrf_failed'
    },
    { status: error.status }
  );
}
