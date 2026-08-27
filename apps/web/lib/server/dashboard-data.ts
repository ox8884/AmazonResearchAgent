import type { Database } from '@ara/db';
import { getServerDatabaseContext, ServerConfigurationError } from './database';
type ImportRunRow = Database['public']['Tables']['import_runs']['Row'];
type CandidateRow = Database['public']['Tables']['candidates']['Row'];

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

export type CandidateSummary = Pick<
  CandidateRow,
  'id' | 'keyword' | 'preliminary_score' | 'rule_passed' | 'rule_reasons' | 'state'
>;

export interface DashboardData {
  readonly imports: readonly ImportSummary[];
  readonly candidates: readonly CandidateSummary[];
  readonly totals: {
    readonly imports: number;
    readonly candidates: number;
    readonly accepted: number;
    readonly rejected: number;
  };
}

export class DashboardQueryError extends Error {
  constructor(query: string, cause?: unknown) {
    super(`Could not load ${query}.`, { cause });
    this.name = 'DashboardQueryError';
  }
}

export async function getDashboardData(): Promise<DashboardData> {
  const { client } = getServerDatabaseContext();
  const [
    importsResult,
    candidatesResult,
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
      .select('id,keyword,preliminary_score,rule_passed,rule_reasons,state')
      .order('preliminary_score', { ascending: false, nullsFirst: false })
      .limit(8),
    client.from('import_runs').select('*', { count: 'exact', head: true }),
    client.from('candidates').select('*', { count: 'exact', head: true }),
    client.from('import_runs').select('accepted_count,rejected_count')
  ]);

  if (importsResult.error) {
    throw new DashboardQueryError('recent imports', importsResult.error);
  }
  if (candidatesResult.error) {
    throw new DashboardQueryError('recent candidates', candidatesResult.error);
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

  return {
    imports: importsResult.data,
    candidates: candidatesResult.data,
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
