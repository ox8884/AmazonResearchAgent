import type { Database } from '@ara/db';
import {
  AnalysisVerdictEvidenceSchema,
  DailyResearchCheckpointSchema,
  DailyResearchJobPayloadSchema,
  DailyResearchSelectedCandidateIdsSchema,
  LocaleSchema,
  LogicalRunDateSchema,
  ResearchSettingsSchema,
  ScheduledMarketProbePayloadSchema,
  type DailyResearchCheckpoint,
  type DailyResearchJobPayload,
  type Locale,
  type LogicalRunDate,
  type ResearchSettings,
  type ScheduledMarketProbePayload
} from '@ara/shared';
import {
  planDailyResearch,
  ResearchPlanBucket,
  type ResearchPlan,
  type ResearchPlanItem
} from '@ara/research-engine';
import type { EnqueueJobInput, Job, QueueDatabaseClient } from '@ara/queue';
import { createQueue, type DurableQueue } from '@ara/queue';
const CHICAGO_TIMEZONE = 'America/Chicago';
const HOURS_TO_MILLISECONDS = 60 * 60 * 1_000;
const SCHEDULED_SOURCE = 'scheduled';
const DAILY_RESEARCH_JOB_TYPE = 'DAILY_RESEARCH' as const;

export interface DailyResearchQueue {
  enqueueJob(input: EnqueueJobInput): Promise<string>;
}

export interface EnqueueDailyResearchInput {
  readonly logicalRunDate: string;
  readonly queue?: DailyResearchQueue;
}

export interface EnqueueDailyResearchResult {
  readonly logicalRunDate: LogicalRunDate;
  readonly researchRunId: string;
  readonly jobId: string;
}
interface ScheduledResearchRun {
  readonly id: string;
  readonly locale: Locale;
}

export interface RunDailyResearchDependencies {
  readonly client: QueueDatabaseClient;
  readonly queue: DailyResearchQueue;
  readonly now?: () => Date;
}

export class DailyResearchError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'DailyResearchError';
  }
}

export function deriveChicagoDate(now = new Date()): LogicalRunDate {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError('Cannot derive a calendar date from an invalid Date.');
  }
  return LogicalRunDateSchema.parse(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: CHICAGO_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(now)
  );
}

export function parseLogicalRunDate(value: string): LogicalRunDate {
  return LogicalRunDateSchema.parse(value);
}

function errorMessage(error: { readonly code?: string; readonly message: string }): string {
  return `${error.code ? `${error.code}: ` : ''}${error.message}`;
}

async function readSettings(
  client: QueueDatabaseClient
): Promise<ResearchSettings> {
  const { data, error } = await client
    .from('app_settings')
    .select(
      'locale,timezone,daily_api_budget,manual_api_reserve,manual_reserve_enabled,new_percent,watch_percent,strong_percent,new_freshness_hours,watch_freshness_hours,strong_freshness_hours,notification_locale,telegram_enabled'
    )
    .eq('id', true)
    .maybeSingle();
  if (error) {
    throw new DailyResearchError(`Could not read app settings: ${errorMessage(error)}`);
  }
  if (!data) {
    return ResearchSettingsSchema.parse({});
  }
  return ResearchSettingsSchema.parse({
    locale: data.locale,
    timezone: data.timezone,
    dailyApiBudget: data.daily_api_budget,
    manualApiReserve: data.manual_api_reserve,
    manualReserveEnabled: data.manual_reserve_enabled,
    newPercent: data.new_percent,
    watchPercent: data.watch_percent,
    strongPercent: data.strong_percent,
    newFreshnessHours: data.new_freshness_hours,
    watchFreshnessHours: data.watch_freshness_hours,
    strongFreshnessHours: data.strong_freshness_hours,
    notificationLocale: data.notification_locale,
    telegramEnabled: data.telegram_enabled
  });
}

async function ensureResearchRun(
  client: QueueDatabaseClient,
  logicalRunDate: LogicalRunDate,
  locale: Locale
): Promise<ScheduledResearchRun> {
  const idempotencyKey = `daily-research:${logicalRunDate}`;
  const insert: Database['public']['Tables']['research_runs']['Insert'] = {
    source: SCHEDULED_SOURCE,
    mode: 'normal',
    logical_run_date: logicalRunDate,
    locale,
    timezone: CHICAGO_TIMEZONE,
    idempotency_key: idempotencyKey
  };
  const { data: inserted, error: insertError } = await client
    .from('research_runs')
    .insert(insert)
    .select('id,locale')
    .maybeSingle();
  if (insertError && insertError.code !== '23505') {
    throw new DailyResearchError(
      `Could not create scheduled research run: ${errorMessage(insertError)}`
    );
  }

  let researchRun: ScheduledResearchRun | undefined = inserted
    ? { id: inserted.id, locale: LocaleSchema.parse(inserted.locale) }
    : undefined;
  if (!researchRun) {
    const { data: existing, error: existingError } = await client
      .from('research_runs')
      .select('id,locale')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (existingError) {
      throw new DailyResearchError(
        `Could not resolve scheduled research run: ${errorMessage(existingError)}`
      );
    }
    researchRun = existing
      ? { id: existing.id, locale: LocaleSchema.parse(existing.locale) }
      : undefined;
  }
  if (!researchRun) {
    throw new DailyResearchError(
      `Scheduled research run ${idempotencyKey} was not visible after enqueue.`
    );
  }

  const { error: lockError } = await client.from('scheduled_run_locks').insert({
    run_date: logicalRunDate,
    research_run_id: researchRun.id
  });
  if (lockError && lockError.code !== '23505') {
    throw new DailyResearchError(
      `Could not lock scheduled research run: ${errorMessage(lockError)}`
    );
  }
  return researchRun;
}

export async function enqueueDailyResearch(
  client: QueueDatabaseClient,
  input: EnqueueDailyResearchInput
): Promise<EnqueueDailyResearchResult> {
  const logicalRunDate = parseLogicalRunDate(input.logicalRunDate);
  const settings = await readSettings(client);
  const researchRun = await ensureResearchRun(
    client,
    logicalRunDate,
    settings.locale
  );
  const queue = input.queue ?? createQueue(client);
  const jobId = await queue.enqueueJob({
    type: DAILY_RESEARCH_JOB_TYPE,
    payload: {
      researchRunId: researchRun.id,
      logicalRunDate,
      locale: researchRun.locale
    } satisfies DailyResearchJobPayload,
    idempotencyKey: `daily-research:${logicalRunDate}`
  });
  return {
    logicalRunDate,
    researchRunId: researchRun.id,
    jobId
  };
}

function latestByCandidate<
  T extends {
    readonly candidate_id: string;
    readonly created_at: string;
    readonly id: string;
  }
>(rows: readonly T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const previous = latest.get(row.candidate_id);
    if (
      !previous ||
      row.created_at > previous.created_at ||
      (row.created_at === previous.created_at && row.id > previous.id)
    ) {
      latest.set(row.candidate_id, row);
    }
  }
  return latest;
}

function informationValue(
  preliminaryScore: number | null,
  capturedAt: string | undefined,
  freshnessHours: number,
  nowMilliseconds: number
): number {
  const score = preliminaryScore ?? 0;
  const capturedMilliseconds = capturedAt ? Date.parse(capturedAt) : Number.NaN;
  const ageHours = Number.isNaN(capturedMilliseconds)
    ? freshnessHours
    : Math.max(0, (nowMilliseconds - capturedMilliseconds) / HOURS_TO_MILLISECONDS);
  return score + ageHours / 24;
}

function isFresh(
  capturedAt: string | undefined,
  freshnessHours: number,
  nowMilliseconds: number
): boolean {
  if (!capturedAt) {
    return false;
  }
  const capturedMilliseconds = Date.parse(capturedAt);
  return (
    !Number.isNaN(capturedMilliseconds) &&
    nowMilliseconds - capturedMilliseconds < freshnessHours * HOURS_TO_MILLISECONDS
  );
}

async function selectResearchPlan(
  client: QueueDatabaseClient,
  settings: ResearchSettings,
  now: Date
): Promise<ResearchPlan> {
  const { data: candidates, error: candidateError } = await client
    .from('candidates')
    .select('id,state,preliminary_score')
    .in('state', ['Ready for API Validation', 'Watch']);
  if (candidateError) {
    throw new DailyResearchError(
      `Could not select daily research candidates: ${errorMessage(candidateError)}`
    );
  }

  const candidateIds = candidates.map((candidate) => candidate.id);
  const evidenceRows: Array<{
    readonly id: string;
    readonly candidate_id: string;
    readonly created_at: string;
    readonly payload: Database['public']['Tables']['candidate_evidence']['Row']['payload'];
  }> = [];
  if (candidateIds.length > 0) {
    const { data: evidence, error: evidenceError } = await client
      .from('candidate_evidence')
      .select('id,candidate_id,created_at,payload')
      .eq('kind', 'analysis_verdict')
      .in('candidate_id', candidateIds);
    if (evidenceError) {
      throw new DailyResearchError(
        `Could not read candidate analysis verdicts: ${errorMessage(evidenceError)}`
      );
    }
    evidenceRows.push(...evidence);
  }
  const latestEvidence = latestByCandidate(evidenceRows);
  const snapshotRows: Array<{
    readonly candidate_id: string | null;
    readonly captured_at: string;
  }> = [];
  if (candidateIds.length > 0) {
    const { data: snapshots, error: snapshotError } = await client
      .from('market_snapshots')
      .select('candidate_id,captured_at')
      .in('candidate_id', candidateIds)
      .order('captured_at', { ascending: false });
    if (snapshotError) {
      throw new DailyResearchError(
        `Could not read market snapshot freshness: ${errorMessage(snapshotError)}`
      );
    }
    snapshotRows.push(...snapshots);
  }
  const latestSnapshots = new Map<string, string>();
  for (const snapshot of snapshotRows) {
    if (snapshot.candidate_id && !latestSnapshots.has(snapshot.candidate_id)) {
      latestSnapshots.set(snapshot.candidate_id, snapshot.captured_at);
    }
  }

  const nowMilliseconds = now.getTime();
  const dailyCandidates = candidates.map((candidate) => {
    const strongEvidence = latestEvidence.get(candidate.id);
    const isStrong = strongEvidence
      ? AnalysisVerdictEvidenceSchema.safeParse(strongEvidence.payload).success
      : false;
    const bucket = isStrong
      ? ResearchPlanBucket.strong
      : candidate.state === 'Watch'
        ? ResearchPlanBucket.watch
        : ResearchPlanBucket.new;
    const freshnessHours =
      bucket === ResearchPlanBucket.new
        ? settings.newFreshnessHours
        : bucket === ResearchPlanBucket.watch
          ? settings.watchFreshnessHours
          : settings.strongFreshnessHours;
    const capturedAt = latestSnapshots.get(candidate.id);
    return {
      id: candidate.id,
      bucket,
      informationValue: informationValue(
        candidate.preliminary_score,
        capturedAt,
        freshnessHours,
        nowMilliseconds
      ),
      isFresh: isFresh(capturedAt, freshnessHours, nowMilliseconds)
    };
  });

  return planDailyResearch(dailyCandidates, {
    slots: settings.dailyApiBudget,
    allocation: {
      new: settings.newPercent,
      watch: settings.watchPercent,
      strong: settings.strongPercent
    }
  });
}

async function updateRun(
  client: QueueDatabaseClient,
  runId: string,
  update: Database['public']['Tables']['research_runs']['Update']
): Promise<void> {
  const { error } = await client
    .from('research_runs')
    .update(update)
    .eq('id', runId);
  if (error) {
    throw new DailyResearchError(`Could not checkpoint daily research run: ${errorMessage(error)}`);
  }
}

function checkpointFromRun(
  selectedCandidateIds: Database['public']['Tables']['research_runs']['Row']['selected_candidate_ids'],
  checkpoint: Database['public']['Tables']['research_runs']['Row']['checkpoint']
): DailyResearchCheckpoint | null {
  const parsedCheckpoint = DailyResearchCheckpointSchema.safeParse(checkpoint);
  const parsedIds = DailyResearchSelectedCandidateIdsSchema.safeParse(selectedCandidateIds);
  if (!parsedCheckpoint.success || !parsedIds.success) {
    return null;
  }
  if (
    parsedCheckpoint.data.selectedItems.length !== parsedIds.data.length ||
    parsedCheckpoint.data.selectedItems.some(
      (item) => !parsedIds.data.includes(item.id)
    )
  ) {
    return null;
  }
  return parsedCheckpoint.data;
}

function childPayload(
  item: ResearchPlanItem,
  locale: DailyResearchJobPayload['locale']
): ScheduledMarketProbePayload {
  return ScheduledMarketProbePayloadSchema.parse({
    candidateId: item.id,
    locale,
    purpose:
      item.bucket === ResearchPlanBucket.strong
        ? 'strong_revalidation'
        : 'normal_validation'
  });
}

export async function runDailyResearch(
  job: Job,
  dependencies: RunDailyResearchDependencies
): Promise<DailyResearchCheckpoint> {
  const payload = DailyResearchJobPayloadSchema.parse(job.payload);
  const now = dependencies.now?.() ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new RangeError('Cannot run daily research with an invalid Date.');
  }

  const { data: run, error: runError } = await dependencies.client
    .from('research_runs')
    .select('id,logical_run_date,locale,selected_candidate_ids,checkpoint')
    .eq('id', payload.researchRunId)
    .maybeSingle();
  if (runError) {
    throw new DailyResearchError(`Could not read scheduled research run: ${errorMessage(runError)}`);
  }
  if (
    !run ||
    run.logical_run_date !== payload.logicalRunDate ||
    LocaleSchema.parse(run.locale) !== payload.locale
  ) {
    throw new DailyResearchError('Daily research job payload does not match its durable run.');
  }

  let checkpoint = checkpointFromRun(run.selected_candidate_ids, run.checkpoint);
  if (!checkpoint) {
    await updateRun(dependencies.client, run.id, {
      status: 'planning',
      started_at: now.toISOString()
    });
    const settings = await readSettings(dependencies.client);
    const plan = await selectResearchPlan(dependencies.client, settings, now);
    const selectedCandidateIds = plan.items.map((item) => item.id);
    checkpoint = {
      phase: 'fanout',
      selectedItems: [...plan.items],
      enqueuedCandidateIds: []
    };
    await updateRun(dependencies.client, run.id, {
      status: 'fanout',
      selected_candidate_ids: selectedCandidateIds,
      checkpoint
    });
  }
  if (!checkpoint) {
    throw new DailyResearchError('Daily research selection checkpoint was not created.');
  }

  const enqueuedCandidateIds = new Set(checkpoint.enqueuedCandidateIds);
  for (const item of checkpoint.selectedItems) {
    if (enqueuedCandidateIds.has(item.id)) {
      continue;
    }
    const payloadForChild = childPayload(item, payload.locale);
    await dependencies.queue.enqueueJob({
      type: 'MARKET_PROBE',
      payload: payloadForChild,
      idempotencyKey: `daily-research:${run.id}:${item.bucket}:${item.id}`
    });
    enqueuedCandidateIds.add(item.id);
    checkpoint = {
      phase: 'fanout',
      selectedItems: checkpoint.selectedItems,
      enqueuedCandidateIds: [...enqueuedCandidateIds]
    };
    await updateRun(dependencies.client, run.id, {
      status: 'fanout',
      checkpoint
    });
  }

  checkpoint = {
    phase: 'fanout_complete',
    selectedItems: checkpoint.selectedItems,
    enqueuedCandidateIds: [...enqueuedCandidateIds]
  };
  await updateRun(dependencies.client, run.id, {
    status: checkpoint.selectedItems.length === 0 ? 'completed' : 'running',
    checkpoint
  });
  return checkpoint;
}

export function createDailyResearchHandler(
  client: QueueDatabaseClient,
  queue: DailyResearchQueue | DurableQueue
): (job: Job) => Promise<DailyResearchCheckpoint> {
  return (job) => runDailyResearch(job, { client, queue });
}
