import { ResearchBusinessEvidenceSchema } from '@ara/shared';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AdminAuthError } from '../../../../../lib/server/admin-session';
import {
  adminAuthErrorResponse,
  requireAdminMutation,
  requireAdminRead
} from '../../../../../lib/server/api-auth';
import { readBoundedJson } from '../../../../../lib/server/bounded-json';
import {
  appendCandidateBusiness,
  CandidateBusinessError,
  getCandidateBusiness
} from '../../../../../lib/server/candidate-business';
import { ServerConfigurationError } from '../../../../../lib/server/database';

const CandidateIdSchema = z.uuid();

export const runtime = 'nodejs';

type RouteContext = {
  readonly params: Promise<{ readonly id: string }>;
};

async function candidateIdFrom(context: RouteContext): Promise<string | null> {
  const { id } = await context.params;
  const parsed = CandidateIdSchema.safeParse(id);
  return parsed.success ? parsed.data : null;
}

function candidateBusinessErrorResponse(error: CandidateBusinessError): NextResponse {
  if (error.kind === 'not_found') {
    return NextResponse.json({ error: 'candidate_not_found' }, { status: 404 });
  }
  return NextResponse.json({ error: 'business_unavailable' }, { status: 503 });
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    await requireAdminRead(request);
    const candidateId = await candidateIdFrom(context);
    if (candidateId === null) {
      return NextResponse.json({ error: 'invalid_candidate_id' }, { status: 400 });
    }
    return NextResponse.json(await getCandidateBusiness(candidateId));
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return adminAuthErrorResponse(error);
    }
    if (error instanceof CandidateBusinessError) {
      return candidateBusinessErrorResponse(error);
    }
    if (error instanceof ServerConfigurationError) {
      return NextResponse.json({ error: 'business_unavailable' }, { status: 503 });
    }
    throw error;
  }
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    await requireAdminMutation(request);
    const candidateId = await candidateIdFrom(context);
    if (candidateId === null) {
      return NextResponse.json({ error: 'invalid_candidate_id' }, { status: 400 });
    }
    const body = await readBoundedJson(request);
    if (body.kind === 'too_large') {
      return NextResponse.json({ error: 'business_evidence_too_large' }, { status: 413 });
    }
    if (body.kind === 'invalid') {
      return NextResponse.json({ error: 'invalid_business_evidence' }, { status: 400 });
    }
    const evidence = ResearchBusinessEvidenceSchema.safeParse(body.value);
    if (!evidence.success) {
      return NextResponse.json({ error: 'invalid_business_evidence' }, { status: 400 });
    }
    return NextResponse.json(
      await appendCandidateBusiness(candidateId, evidence.data),
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return adminAuthErrorResponse(error);
    }
    if (error instanceof CandidateBusinessError) {
      return candidateBusinessErrorResponse(error);
    }
    if (error instanceof ServerConfigurationError) {
      return NextResponse.json({ error: 'business_unavailable' }, { status: 503 });
    }
    throw error;
  }
}
