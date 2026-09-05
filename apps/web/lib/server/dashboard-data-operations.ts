import { getServerDatabaseContext } from './database';
import { DashboardQueryError, safe } from './dashboard-query';
import { z } from 'zod';

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
  const counts = await getExactCounts('jobs');
  return {
    queued: counts['queued'] ?? 0,
    running: counts['running'] ?? 0,
    failed: counts['failed'] ?? 0,
    completed: counts['completed'] ?? 0
  };
}

async function getExactCounts(entity: 'jobs' | 'candidates'): Promise<Record<string, number>> {
  const { client } = getServerDatabaseContext();
  const { data, error } = await client.rpc('get_dashboard_counts', { entity });
  if (error) throw new DashboardQueryError(`${entity} counts`, error);
  const parsed = z.record(z.string(), z.number().int().nonnegative().safe()).safeParse(data);
  if (!parsed.success) throw new DashboardQueryError(`${entity} counts`, parsed.error);
  return parsed.data;
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
  return getExactCounts('candidates');
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
