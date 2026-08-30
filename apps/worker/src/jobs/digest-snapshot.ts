import type { DailyDigestSnapshot, DigestCandidate } from '@ara/notifications';
import type { QueueDatabaseClient } from '@ara/queue';
import type { Locale } from '@ara/shared';

const TOP_STATES = ['Strong', 'Watch', 'Deep Research'] as const;

function rankState(state: string): number {
  if (state === 'Strong') {
    return 0;
  }
  if (state === 'Watch') {
    return 1;
  }
  return 2;
}

function candidateFromRow(row: {
  readonly keyword: string | null;
  readonly state: string;
  readonly preliminary_score: number | null;
  readonly preliminary_score_components: unknown;
}): DigestCandidate | null {
  const title = row.keyword?.trim();
  if (!title) {
    return null;
  }
  const components =
    row.preliminary_score_components &&
    typeof row.preliminary_score_components === 'object' &&
    !Array.isArray(row.preliminary_score_components)
      ? (row.preliminary_score_components as Record<string, unknown>)
      : {};
  const score = typeof row.preliminary_score === 'number' ? row.preliminary_score : undefined;
  const competition = typeof components.competition === 'number' ? components.competition : undefined;
  const demand = typeof components.demand === 'number' ? components.demand : undefined;
  const margin = typeof components.margin === 'number' ? components.margin : undefined;
  const differentiation =
    typeof components.differentiation === 'number' ? components.differentiation : undefined;
  return {
    title,
    state: row.state,
    ...(score !== undefined ? { score } : {}),
    ...(competition !== undefined ? { competition } : {}),
    ...(demand !== undefined ? { demand } : {}),
    ...(margin !== undefined ? { margin } : {}),
    ...(differentiation !== undefined ? { differentiation } : {})
  };
}

export async function loadDailyDigestSnapshot(
  client: QueueDatabaseClient,
  researchRunId: string,
  locale: Locale
): Promise<DailyDigestSnapshot | undefined> {
  const { data: run, error: runError } = await client
    .from('research_runs')
    .select('id,logical_run_date,started_at,completed_at')
    .eq('id', researchRunId)
    .maybeSingle();
  if (runError) {
    throw new Error(`Could not load research run: ${runError.message}`);
  }
  if (!run) {
    return undefined;
  }
  const { data: settings, error: settingsError } = await client
    .from('app_settings')
    .select('daily_api_budget,manual_api_reserve')
    .eq('id', true)
    .maybeSingle();
  if (settingsError) {
    throw new Error(`Could not load settings: ${settingsError.message}`);
  }
  const { data: budget, error: budgetError } = await client
    .from('api_budget_daily')
    .select('used_count,reserved_used_count')
    .eq('budget_date', run.logical_run_date)
    .maybeSingle();
  if (budgetError) {
    throw new Error(`Could not load API budget: ${budgetError.message}`);
  }
  const { data: ranked, error: rankedError } = await client
    .from('candidates')
    .select('keyword,state,preliminary_score,preliminary_score_components')
    .in('state', [...TOP_STATES])
    .order('preliminary_score', { ascending: false, nullsFirst: false })
    .limit(20);
  if (rankedError) {
    throw new Error(`Could not load top candidates: ${rankedError.message}`);
  }

  const keywordCount = await client.from('raw_opportunity_keywords').select('id', { count: 'exact', head: true });
  const nicheCount = await client.from('niche_clusters').select('id', { count: 'exact', head: true });
  const candidateCount = await client.from('candidates').select('id', { count: 'exact', head: true });
  const strongCount = await client.from('candidates').select('id', { count: 'exact', head: true }).eq('state', 'Strong');
  const watchCount = await client.from('candidates').select('id', { count: 'exact', head: true }).eq('state', 'Watch');
  const rejectCount = await client.from('candidates').select('id', { count: 'exact', head: true }).eq('state', 'Reject');
  const attentionCount = await client
    .from('candidates')
    .select('id', { count: 'exact', head: true })
    .eq('state', 'Needs Attention');
  const deepCount = await client
    .from('candidates')
    .select('id', { count: 'exact', head: true })
    .eq('state', 'Deep Research');
  for (const result of [
    keywordCount,
    nicheCount,
    candidateCount,
    strongCount,
    watchCount,
    rejectCount,
    attentionCount,
    deepCount
  ]) {
    if (result.error) {
      throw new Error(`Could not count digest rows: ${result.error.message}`);
    }
  }

  let aiAnalyses: number | undefined;
  if (run.started_at) {
    let aiQuery = client.from('ai_usage').select('id', { count: 'exact', head: true }).gte('created_at', run.started_at);
    if (run.completed_at) {
      aiQuery = aiQuery.lte('created_at', run.completed_at);
    }
    const aiCount = await aiQuery;
    if (aiCount.error) {
      throw new Error(`Could not count AI usage: ${aiCount.error.message}`);
    }
    aiAnalyses = aiCount.count ?? 0;
  }

  const topCandidates = (ranked ?? [])
    .slice()
    .sort((left, right) => {
      const byState = rankState(left.state) - rankState(right.state);
      if (byState !== 0) {
        return byState;
      }
      return (right.preliminary_score ?? -1) - (left.preliminary_score ?? -1);
    })
    .map(candidateFromRow)
    .filter((candidate): candidate is DigestCandidate => candidate !== null)
    .slice(0, 3);

  return {
    logicalRunDate: run.logical_run_date,
    importedKeywords: keywordCount.count ?? 0,
    normalizedNiches: nicheCount.count ?? 0,
    candidatesEvaluated: candidateCount.count ?? 0,
    strong: strongCount.count ?? 0,
    watch: watchCount.count ?? 0,
    reject: rejectCount.count ?? 0,
    needsAttention: attentionCount.count ?? 0,
    deepResearch: deepCount.count ?? 0,
    topCandidates,
    jungleScoutUsed: budget?.used_count ?? 0,
    jungleScoutBudget: settings?.daily_api_budget ?? 20,
    reservedUsed: budget?.reserved_used_count ?? 0,
    reservedBudget: settings?.manual_api_reserve ?? 5,
    ...(aiAnalyses !== undefined ? { aiAnalyses } : {}),
    runIdShort: researchRunId.slice(0, 8),
    nextRunLabel: locale === 'ko' ? '내일 03:00 CT' : 'tomorrow 03:00 CT'
  };
}

export function researchRunIdFromNotifications(
  rows: readonly {
    readonly event_type: string;
    readonly payload: unknown;
    readonly idempotency_key: string;
  }[],
  explicit?: string
): string | undefined {
  if (explicit) {
    return explicit;
  }
  for (const row of rows) {
    if (row.event_type !== 'DAILY_SUMMARY') {
      continue;
    }
    if (row.idempotency_key.startsWith('daily-summary:')) {
      return row.idempotency_key.slice('daily-summary:'.length);
    }
    if (row.payload && typeof row.payload === 'object' && 'researchRunId' in row.payload) {
      const value = row.payload.researchRunId;
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
  }
  return undefined;
}
