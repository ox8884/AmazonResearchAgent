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
  /** Decision-queue rows: review-needed states first, then top preliminary scores. */
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
  const candidates: CandidateSummary[] = [];
  const seenIds = new Set<string>();
  for (const row of [...reviewResult.data, ...topResult.data]) {
    if (seenIds.has(row.id)) continue;
    seenIds.add(row.id);
    candidates.push(row);
    if (candidates.length >= 8) break;
  }

  return {
    imports: importsResult.data,
    candidates,
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type JobCounts = {
  readonly queued: number;
  readonly running: number;
  readonly failed: number;
  readonly completed: number;
};

export type ApiBudgetMeter = {
  readonly used: number;
  readonly dailyLimit: number;
  readonly reservedLimit: number;
  readonly hasRecord: boolean;
};

export type CandidateStateCounts = Record<string, number>;

export type CandidateDetail = {
  readonly id: string;
  readonly keyword: string | null;
  readonly state: string | null;
  readonly preliminaryScore: number | null;
  readonly competition: number | null;
  readonly demand: number | null;
  readonly margin: number | null;
  readonly differentiation: number | null;
  readonly evidence: readonly { readonly kind: string; readonly payload: unknown }[];
};

export type ResearchRunSummary = {
  readonly id: string;
  readonly source: string;
  readonly status: string;
  readonly logicalRunDate: string;
  readonly createdAt: string;
};

function emptyJobCounts(): JobCounts {
  return { queued: 0, running: 0, failed: 0, completed: 0 };
}

export async function getJobCounts(): Promise<JobCounts> {
  const { client } = getServerDatabaseContext();
  const { data, error } = await client.from('jobs').select('status');
  if (error) throw new DashboardQueryError('job counts', error);
  return (data ?? []).reduce<JobCounts>((counts, job) => {
    if (job.status === 'queued') return { ...counts, queued: counts.queued + 1 };
    if (job.status === 'running') return { ...counts, running: counts.running + 1 };
    if (job.status === 'failed') return { ...counts, failed: counts.failed + 1 };
    if (job.status === 'completed') return { ...counts, completed: counts.completed + 1 };
    return counts;
  }, emptyJobCounts());
}

export async function getApiBudgetMeter(): Promise<ApiBudgetMeter> {
  const { client } = getServerDatabaseContext();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  const { data, error } = await client
    .from('api_budget_daily')
    .select('used_count,daily_limit,reserved_limit')
    .eq('budget_date', today)
    .maybeSingle();
  if (error) throw new DashboardQueryError('api budget', error);
  return {
    used: data?.used_count ?? 0,
    dailyLimit: data?.daily_limit ?? 0,
    reservedLimit: data?.reserved_limit ?? 0,
    hasRecord: data !== null
  };
}

export async function getCandidateStateCounts(): Promise<CandidateStateCounts> {
  const { client } = getServerDatabaseContext();
  const { data, error } = await client.from('candidates').select('state');
  if (error) throw new DashboardQueryError('candidate state counts', error);
  return (data ?? []).reduce<CandidateStateCounts>((counts, row) => {
    const key = row.state ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

export async function getCandidates(): Promise<readonly CandidateSummary[]> {
  const { client } = getServerDatabaseContext();
  const { data, error } = await client
    .from('candidates')
    .select('id,keyword,preliminary_score,rule_passed,rule_reasons,state')
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) throw new DashboardQueryError('candidates', error);
  return data;
}

export async function getCandidateDetail(id: string): Promise<CandidateDetail> {
  if (!UUID_PATTERN.test(id)) {
    return {
      id,
      keyword: null,
      state: null,
      preliminaryScore: null,
      competition: null,
      demand: null,
      margin: null,
      differentiation: null,
      evidence: []
    };
  }
  const { client } = getServerDatabaseContext();
  const [{ data: candidate, error: candidateError }, { data: evidence, error: evidenceError }] =
    await Promise.all([
      client
        .from('candidates')
        .select('id,keyword,state,preliminary_score,preliminary_score_components')
        .eq('id', id)
        .maybeSingle(),
      client
        .from('candidate_evidence')
        .select('kind,payload')
        .eq('candidate_id', id)
        .order('created_at', { ascending: false })
        .limit(20)
    ]);
  if (candidateError) throw new DashboardQueryError('candidate', candidateError);
  if (evidenceError) throw new DashboardQueryError('candidate evidence', evidenceError);
  const components =
    candidate?.preliminary_score_components &&
    typeof candidate.preliminary_score_components === 'object' &&
    !Array.isArray(candidate.preliminary_score_components)
      ? candidate.preliminary_score_components
      : {};
  const numberAt = (key: string): number | null => {
    if (!(key in components)) return null;
    const value = components[key];
    return typeof value === 'number' ? value : null;
  };
  return {
    id,
    keyword: candidate?.keyword ?? null,
    state: candidate?.state ?? null,
    preliminaryScore: candidate?.preliminary_score ?? null,
    competition: numberAt('competition'),
    demand: numberAt('demand'),
    margin: numberAt('margin'),
    differentiation: numberAt('differentiation'),
    evidence: evidence ?? []
  };
}

export async function getResearchRuns(): Promise<readonly ResearchRunSummary[]> {
  const { client } = getServerDatabaseContext();
  const { data, error } = await client
    .from('research_runs')
    .select('id,source,status,logical_run_date,created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new DashboardQueryError('research runs', error);
  return (data ?? []).map((run) => ({
    id: run.id,
    source: run.source,
    status: run.status,
    logicalRunDate: run.logical_run_date,
    createdAt: run.created_at
  }));
}

async function safe<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof ServerConfigurationError || error instanceof DashboardQueryError) {
      return fallback;
    }
    throw error;
  }
}

export function getJobCountsView(): Promise<JobCounts> {
  return safe(getJobCounts, emptyJobCounts());
}

export function getApiBudgetMeterView(): Promise<ApiBudgetMeter> {
  return safe(getApiBudgetMeter, {
    used: 0,
    dailyLimit: 0,
    reservedLimit: 0,
    hasRecord: false
  });
}

export function getCandidateStateCountsView(): Promise<CandidateStateCounts> {
  return safe(getCandidateStateCounts, {});
}

export function getCandidatesView(): Promise<readonly CandidateSummary[]> {
  return safe(getCandidates, []);
}

export function getCandidateDetailView(id: string): Promise<CandidateDetail> {
  return safe(
    () => getCandidateDetail(id),
    {
      id,
      keyword: null,
      state: null,
      preliminaryScore: null,
      competition: null,
      demand: null,
      margin: null,
      differentiation: null,
      evidence: []
    }
  );
}

export function getResearchRunsView(): Promise<readonly ResearchRunSummary[]> {
  return safe(getResearchRuns, []);
}

export type ResearchSettingsView = {
  readonly locale: string;
  readonly timezone: string;
  readonly newPercent: number;
  readonly watchPercent: number;
  readonly strongPercent: number;
  readonly dailyApiBudget: number;
  readonly manualReserveEnabled: boolean;
};

export function getResearchSettingsView(): Promise<ResearchSettingsView | null> {
  return safe(async () => {
    const { client } = getServerDatabaseContext();
    const { data, error } = await client
      .from('app_settings')
      .select(
        'locale,timezone,new_percent,watch_percent,strong_percent,daily_api_budget,manual_reserve_enabled'
      )
      .eq('id', true)
      .maybeSingle();
    if (error) throw new DashboardQueryError('research settings', error);
    if (!data) return null;
    return {
      locale: data.locale,
      timezone: data.timezone,
      newPercent: data.new_percent,
      watchPercent: data.watch_percent,
      strongPercent: data.strong_percent,
      dailyApiBudget: data.daily_api_budget,
      manualReserveEnabled: data.manual_reserve_enabled
    };
  }, null);
}
