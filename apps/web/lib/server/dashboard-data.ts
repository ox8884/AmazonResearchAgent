import type { Database } from '@ara/db';
import { getServerDatabaseContext, ServerConfigurationError } from './database';
import { DashboardQueryError } from './dashboard-query';
import { hydrateCandidateEvidence, type CandidateSummary } from './dashboard-data-candidates';
export { DashboardQueryError } from './dashboard-query';
export { getCandidates, getCandidatesView, getCandidateDetail, getCandidateDetailView } from './dashboard-data-candidates';
export type { CandidateSummary, CandidateDetail } from './dashboard-data-candidates';
export * from './dashboard-data-operations';
type ImportRunRow = Database['public']['Tables']['import_runs']['Row'];

export type ImportSummary = Pick<
  ImportRunRow,
  | 'id'
  | 'status'
  | 'file_count'
  | 'total_row_count'
  | 'unique_keyword_count'
  | 'duplicate_keyword_count'
  | 'accepted_count'
  | 'rejected_count'
  | 'created_at'
>;

export interface DashboardData {
  readonly imports: readonly ImportSummary[];
  /** Decision-queue rows: review-needed states first, then top preliminary scores. */
  readonly candidates: readonly CandidateSummary[];
  readonly totals: {
    readonly imports: number;
    readonly candidates: number;
    readonly accepted: number;
    readonly rejected: number;
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  const { client } = getServerDatabaseContext();
  const candidateFields = 'id,keyword,preliminary_score,rule_passed,rule_reasons,state';
  const [
    importsResult,
    reviewResult,
    topResult,
    importCountResult,
    candidateCountResult,
    aggregateResult
  ] = await Promise.all([
    client
      .from('import_runs')
      .select('id,status,file_count,total_row_count,unique_keyword_count,duplicate_keyword_count,accepted_count,rejected_count,created_at')
      .order('created_at', { ascending: false })
      .limit(6),
    client
      .from('candidates')
      .select(candidateFields)
      .in('state', ['Needs Review', 'Needs Attention'])
      .order('preliminary_score', { ascending: false, nullsFirst: false })
      .limit(8),
    client
      .from('candidates')
      .select(candidateFields)
      .order('preliminary_score', { ascending: false, nullsFirst: false })
      .limit(8),
    client.from('import_runs').select('*', { count: 'exact', head: true }),
    client.from('candidates').select('*', { count: 'exact', head: true }),
    client.from('import_runs').select('accepted_count,rejected_count')
  ]);

  if (importsResult.error) {
    throw new DashboardQueryError('recent imports', importsResult.error);
  }
  if (reviewResult.error) {
    throw new DashboardQueryError('review-needed candidates', reviewResult.error);
  }
  if (topResult.error) {
    throw new DashboardQueryError('recent candidates', topResult.error);
  }
  if (importCountResult.error) {
    throw new DashboardQueryError('import count', importCountResult.error);
  }
  if (candidateCountResult.error) {
    throw new DashboardQueryError('candidate count', candidateCountResult.error);
  }
  if (aggregateResult.error) {
    throw new DashboardQueryError('candidate decision totals', aggregateResult.error);
  }

  const totals = aggregateResult.data.reduce(
    (result, importRun) => ({
      accepted: result.accepted + importRun.accepted_count,
      rejected: result.rejected + importRun.rejected_count
    }),
    { accepted: 0, rejected: 0 }
  );

  // Decision queue order: review-needed states first (score desc), then top
  // scores. Only existing status/score data is used; no business ranking is
  // invented here.
  const candidates: Omit<CandidateSummary, 'evidence'>[] = [];
  const seenIds = new Set<string>();
  for (const row of [...reviewResult.data, ...topResult.data]) {
    if (seenIds.has(row.id)) continue;
    seenIds.add(row.id);
    candidates.push(row);
    if (candidates.length >= 8) break;
  }

  return {
    imports: importsResult.data,
    candidates: await hydrateCandidateEvidence(client, candidates),
    totals: {
      imports: importCountResult.count ?? 0,
      candidates: candidateCountResult.count ?? 0,
      accepted: totals.accepted,
      rejected: totals.rejected
    }
  };
}

export async function getImports(): Promise<readonly ImportSummary[]> {
  const { client } = getServerDatabaseContext();
  const { data, error } = await client
    .from('import_runs')
    .select('id,status,file_count,total_row_count,unique_keyword_count,duplicate_keyword_count,accepted_count,rejected_count,created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    throw new DashboardQueryError('imports', error);
  }
  return data;
}

export type DashboardView =
  | { readonly kind: 'ready'; readonly data: DashboardData }
  | { readonly kind: 'unavailable'; readonly data: DashboardData };

export async function getDashboardView(): Promise<DashboardView> {
  try {
    return { kind: 'ready', data: await getDashboardData() };
  } catch (error) {
    if (error instanceof ServerConfigurationError || error instanceof DashboardQueryError) {
      return {
        kind: 'unavailable',
        data: {
          imports: [],
          candidates: [],
          totals: { imports: 0, candidates: 0, accepted: 0, rejected: 0 }
        }
      };
    }
    throw error;
  }
}

export type ImportsView =
  | { readonly kind: 'ready'; readonly imports: readonly ImportSummary[] }
  | { readonly kind: 'unavailable'; readonly imports: readonly ImportSummary[] };

export async function getImportsView(): Promise<ImportsView> {
  try {
    return { kind: 'ready', imports: await getImports() };
  } catch (error) {
    if (error instanceof ServerConfigurationError || error instanceof DashboardQueryError) {
      return { kind: 'unavailable', imports: [] };
    }
    throw error;
  }
}
