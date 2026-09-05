import {
  createResearchSettingsRepository,
  ResearchSettingsRepositoryError
} from '@ara/db';
import { ResearchBusinessSettingsSchema } from '@ara/shared';
import { NextResponse } from 'next/server';
import { AdminAuthError } from '../../../lib/server/admin-session';
import {
  adminAuthErrorResponse,
  requireAdminMutation,
  requireAdminRead
} from '../../../lib/server/api-auth';
import { readBoundedJson } from '../../../lib/server/bounded-json';
import {
  getServerDatabaseContext,
  ServerConfigurationError
} from '../../../lib/server/database';

export const runtime = 'nodejs';

function unavailableResponse(): NextResponse {
  return NextResponse.json({ error: 'research_settings_unavailable' }, { status: 503 });
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireAdminRead(request);
    const { client } = getServerDatabaseContext();
    const settings = await createResearchSettingsRepository(client).read();
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return adminAuthErrorResponse(error);
    }
    if (
      error instanceof ResearchSettingsRepositoryError ||
      error instanceof ServerConfigurationError
    ) {
      return unavailableResponse();
    }
    throw error;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    await requireAdminMutation(request);
    const body = await readBoundedJson(request);
    if (body.kind === 'too_large') {
      return NextResponse.json({ error: 'research_settings_too_large' }, { status: 413 });
    }
    if (body.kind === 'invalid') {
      return NextResponse.json({ error: 'invalid_research_settings' }, { status: 400 });
    }
    const settings = ResearchBusinessSettingsSchema.safeParse(body.value);
    if (!settings.success) {
      return NextResponse.json({ error: 'invalid_research_settings' }, { status: 400 });
    }
    const { client } = getServerDatabaseContext();
    const saved = await createResearchSettingsRepository(client).save(settings.data);
    return NextResponse.json({ settings: saved });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return adminAuthErrorResponse(error);
    }
    if (
      error instanceof ResearchSettingsRepositoryError ||
      error instanceof ServerConfigurationError
    ) {
      return unavailableResponse();
    }
    throw error;
  }
}
