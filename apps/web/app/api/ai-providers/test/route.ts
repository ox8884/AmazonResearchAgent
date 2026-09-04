import { randomUUID } from 'node:crypto';
import { createQueue } from '@ara/queue';
import { TestAiProviderConnectionJobPayloadSchema } from '@ara/shared';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  adminAuthErrorResponse,
  requireAdminMutation
} from '../../../../lib/server/api-auth';
import { AdminAuthError } from '../../../../lib/server/admin-session';
import {
  getServerDatabaseContext,
  ServerConfigurationError
} from '../../../../lib/server/database';

export const runtime = 'nodejs';

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    await requireAdminMutation(request);
    const payload = TestAiProviderConnectionJobPayloadSchema.strict().safeParse(
      await readJson(request)
    );
    if (!payload.success) {
      return NextResponse.json({ error: 'invalid_provider' }, { status: 400 });
    }
    const { client } = getServerDatabaseContext();
    const { data: provider, error } = await client
      .from('ai_providers')
      .select('id')
      .eq('id', payload.data.providerId)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: 'provider_store_unavailable' }, { status: 503 });
    }
    if (!provider) {
      return NextResponse.json({ error: 'provider_not_found' }, { status: 404 });
    }
    const jobId = await createQueue(client).enqueueJob({
      type: 'TEST_AI_PROVIDER_CONNECTION',
      payload: payload.data,
      idempotencyKey: `provider-test:${provider.id}:${randomUUID()}`,
      priority: 10
    });
    return NextResponse.json({ jobId, status: 'queued' }, { status: 202 });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return adminAuthErrorResponse(error);
    }
    if (error instanceof ServerConfigurationError || error instanceof z.ZodError) {
      return NextResponse.json({ error: 'provider_store_unavailable' }, { status: 503 });
    }
    throw error;
  }
}
