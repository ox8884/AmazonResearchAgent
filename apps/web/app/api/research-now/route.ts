import { ResearchNowModeSchema } from '@ara/shared';
import { NextResponse } from 'next/server';
import { AdminAuthError } from '../../../lib/server/admin-session';
import {
  adminAuthErrorResponse,
  requireAdminMutation
} from '../../../lib/server/api-auth';
import { ServerConfigurationError } from '../../../lib/server/database';
import {
  enqueueResearchNow,
  ResearchNowEnqueueError
} from '../../../lib/server/research-now';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    requireAdminMutation(request);
    const body = await request.json().catch(() => null);
    const modeResult = ResearchNowModeSchema.safeParse(
      body && typeof body === 'object' && 'mode' in body ? body.mode : undefined
    );
    if (!modeResult.success) {
      return NextResponse.json({ error: 'invalid_mode' }, { status: 400 });
    }
    const result = await enqueueResearchNow(modeResult.data);
    return NextResponse.json(
      { research_run_id: result.researchRunId },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return adminAuthErrorResponse(error);
    }
    if (
      error instanceof ResearchNowEnqueueError ||
      error instanceof ServerConfigurationError
    ) {
      return NextResponse.json({ error: 'enqueue_unavailable' }, { status: 503 });
    }
    throw error;
  }
}
