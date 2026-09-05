import type { Database } from '@ara/db';
import { z } from 'zod';
import {
  EVIDENCE_RECORD_LIMIT, projectCandidateEvidence,
  type CandidateEvidenceView
} from '../candidate-evidence';
import { getServerDatabaseContext } from './database';
import { DashboardQueryError, safe } from './dashboard-query';

type CandidateRow = Database['public']['Tables']['candidates']['Row'];
type CandidateIdentity = Pick<CandidateRow,
  'id' | 'keyword' | 'preliminary_score' | 'rule_passed' | 'rule_reasons' | 'state'>;
type DatabaseClient = ReturnType<typeof getServerDatabaseContext>['client'];
export type CandidateSummary = CandidateIdentity & { readonly evidence: CandidateEvidenceView };
export type CandidateDetail = {
  readonly id: string;
  readonly keyword: string | null;
  readonly state: string | null;
  readonly preliminaryScore: number | null;
  readonly competition: number | null;
  readonly demand: number | null;
  readonly margin: number | null;
  readonly differentiation: number | null;
  readonly evidence: CandidateEvidenceView;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ScoreComponents = z.object({
  competition: z.number().nullable().optional(), demand: z.number().nullable().optional(),
  margin: z.number().nullable().optional(), differentiation: z.number().nullable().optional()
});

async function readEvidence(client: DatabaseClient, ids: readonly string[]) {
  const { data, error } = await client.from('candidates')
    .select('id,candidate_evidence(id,kind,payload,created_at)')
    .in('id', [...ids])
    .order('created_at', { referencedTable: 'candidate_evidence', ascending: false })
    .order('id', { referencedTable: 'candidate_evidence', ascending: false })
    .limit(EVIDENCE_RECORD_LIMIT + 1, { referencedTable: 'candidate_evidence' });
  if (error) throw new DashboardQueryError('candidate evidence', error);
  return new Map(data.map((candidate) => [candidate.id, projectCandidateEvidence(candidate.candidate_evidence)]));
}

export async function hydrateCandidateEvidence(
  client: DatabaseClient, candidates: readonly CandidateIdentity[]
): Promise<readonly CandidateSummary[]> {
  if (candidates.length === 0) return [];
  const views = await safe(() => readEvidence(client, candidates.map((row) => row.id)), null);
  return candidates.map((candidate) => ({
    ...candidate, evidence: views?.get(candidate.id) ?? { kind: 'unavailable' }
  }));
}

export async function getCandidates(): Promise<readonly CandidateSummary[]> {
  const { client } = getServerDatabaseContext();
  const { data, error } = await client.from('candidates')
    .select('id,keyword,preliminary_score,rule_passed,rule_reasons,state')
    .order('updated_at', { ascending: false }).limit(50);
  if (error) throw new DashboardQueryError('candidates', error);
  return hydrateCandidateEvidence(client, data);
}

function emptyCandidate(id: string): CandidateDetail {
  return {
    id, keyword: null, state: null, preliminaryScore: null,
    competition: null, demand: null, margin: null, differentiation: null,
    evidence: { kind: 'unavailable' }
  };
}

export async function getCandidateDetail(id: string): Promise<CandidateDetail> {
  if (!UUID_PATTERN.test(id)) return emptyCandidate(id);
  const { client } = getServerDatabaseContext();
  const [{ data: candidate, error }, views] = await Promise.all([
    client.from('candidates').select('id,keyword,state,preliminary_score,preliminary_score_components')
      .eq('id', id).maybeSingle(),
    safe(() => readEvidence(client, [id]), null)
  ]);
  if (error) throw new DashboardQueryError('candidate', error);
  const parsed = ScoreComponents.safeParse(candidate?.preliminary_score_components);
  const scores = parsed.success ? parsed.data : {};
  return {
    ...emptyCandidate(id), keyword: candidate?.keyword ?? null,
    state: candidate?.state ?? null, preliminaryScore: candidate?.preliminary_score ?? null,
    competition: scores.competition ?? null, demand: scores.demand ?? null,
    margin: scores.margin ?? null, differentiation: scores.differentiation ?? null,
    evidence: views?.get(id) ?? { kind: 'unavailable' }
  };
}

export function getCandidatesView(): Promise<readonly CandidateSummary[]> {
  return safe(getCandidates, []);
}

export function getCandidateDetailView(id: string): Promise<CandidateDetail> {
  return safe(() => getCandidateDetail(id), emptyCandidate(id));
}
