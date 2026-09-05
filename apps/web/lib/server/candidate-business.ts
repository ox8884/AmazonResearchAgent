import {
  assessResearchBusiness,
  selectLatestResearchBusiness,
  type ResearchBusinessAssessment,
  type ResearchBusinessEvidence,
  type ResearchBusinessSettings
} from '@ara/shared';
import {
  createResearchSettingsRepository,
  type Json
} from '@ara/db';
import { getServerDatabaseContext } from './database';

export type CandidateBusinessResult = {
  readonly evidence: ResearchBusinessEvidence | null;
  readonly assessment: ResearchBusinessAssessment;
};

export class CandidateBusinessError extends Error {
  constructor(readonly kind: 'not_found' | 'unavailable', cause?: unknown) {
    super('Candidate business evidence is unavailable.', { cause });
    this.name = 'CandidateBusinessError';
  }
}

function asJson(value: unknown): Json {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(asJson);
  }
  if (typeof value === 'object') {
    const object: { [key: string]: Json | undefined } = {};
    for (const [key, entry] of Object.entries(value)) {
      object[key] = asJson(entry);
    }
    return object;
  }
  throw new CandidateBusinessError('unavailable');
}

async function requireCandidate(
  client: ReturnType<typeof getServerDatabaseContext>['client'],
  candidateId: string
): Promise<void> {
  const { data, error } = await client
    .from('candidates')
    .select('id')
    .eq('id', candidateId)
    .maybeSingle();
  if (error) {
    throw new CandidateBusinessError('unavailable', error);
  }
  if (data === null) {
    throw new CandidateBusinessError('not_found');
  }
}

export async function getCandidateBusiness(
  candidateId: string
): Promise<CandidateBusinessResult> {
  const { client } = getServerDatabaseContext();
  await requireCandidate(client, candidateId);
  let settings: ResearchBusinessSettings;
  try {
    settings = await createResearchSettingsRepository(client).read();
  } catch (error) {
    throw new CandidateBusinessError('unavailable', error);
  }
  const { data, error } = await client
    .from('candidate_evidence')
    .select('id,created_at,payload')
    .eq('candidate_id', candidateId)
    .eq('kind', 'research_business_v1')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);
  if (error) {
    throw new CandidateBusinessError('unavailable', error);
  }
  const evidence = selectLatestResearchBusiness(data);
  return {
    evidence,
    assessment: assessResearchBusiness(evidence, new Date(), settings)
  };
}

export async function appendCandidateBusiness(
  candidateId: string,
  evidence: ResearchBusinessEvidence
): Promise<CandidateBusinessResult> {
  const { client } = getServerDatabaseContext();
  await requireCandidate(client, candidateId);
  let settings: ResearchBusinessSettings;
  try {
    settings = await createResearchSettingsRepository(client).read();
  } catch (error) {
    throw new CandidateBusinessError('unavailable', error);
  }
  const { error } = await client
    .from('candidate_evidence')
    .insert({
      candidate_id: candidateId,
      kind: 'research_business_v1',
      payload: asJson(evidence)
    });
  if (error) {
    throw new CandidateBusinessError('unavailable', error);
  }
  return {
    evidence,
    assessment: assessResearchBusiness(evidence, new Date(), settings)
  };
}
