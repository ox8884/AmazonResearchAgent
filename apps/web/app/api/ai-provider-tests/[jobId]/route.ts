import { NextResponse } from 'next/server';
import {
  adminAuthErrorResponse,
  requireAdminRead
} from '../../../../lib/server/api-auth';
import { AdminAuthError } from '../../../../lib/server/admin-session';
import {
  getServerDatabaseContext,
  ServerConfigurationError
} from '../../../../lib/server/database';

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
): Promise<NextResponse> {
  try {
    requireAdminRead(request);
    const { jobId } = await context.params;
    const { client } = getServerDatabaseContext();
    const { data, error } = await client
      .from('jobs')
      .select('id,status,checkpoint,last_error')
      .eq('id', jobId)
      .eq('type', 'TEST_AI_PROVIDER_CONNECTION')
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: 'provider_store_unavailable' }, { status: 503 });
    }
    if (!data) {
      return NextResponse.json({ error: 'provider_test_not_found' }, { status: 404 });
    }
    return NextResponse.json({
      jobId: data.id,
      status: data.status,
      result: data.checkpoint,
      errorCategory: data.last_error ? 'provider_test_failed' : null
    });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return adminAuthErrorResponse(error);
    }
    if (error instanceof ServerConfigurationError) {
      return NextResponse.json({ error: 'provider_store_unavailable' }, { status: 503 });
    }
    throw error;
  }
}
