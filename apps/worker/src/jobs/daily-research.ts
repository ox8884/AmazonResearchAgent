import {
  createMigration019CompatibilityRepository,
  createNormalizationRearmRepository,
  type Database
} from '@ara/db';
import {
  AnalysisVerdictEvidenceSchema,
  DailyResearchCheckpointSchema,
  DailyResearchJobPayloadSchema,
  DailyResearchSelectedCandidateIdsSchema,
  DeepValidationJobPayloadSchema,
  EnrichStrongPotentialJobPayloadSchema,
  LocaleSchema,
  LogicalRunDateSchema,
  ResearchSettingsSchema,
  ScheduledMarketProbePayloadSchema,
  type DailyResearchCheckpoint,
  type DailyResearchJobPayload,
  type Locale,
  type LogicalRunDate,
  type ResearchSettings,
  type ScheduledMarketProbePayload,
  type JungleScoutEndpoint
} from '@ara/shared';
import { DEFAULT_CACHE_TTL_MS } from '@ara/api-budget';
import {
  planDailyResearch,
  ResearchPlanBucket,
  type ResearchPlan,
  type ResearchPlanItem
} from '@ara/research-engine';
import type { EnqueueJobInput, Job, QueueDatabaseClient } from '@ara/queue';
import { createQueue, type DurableQueue } from '@ara/queue';
import {
  assessResearchApiAdmission,
  isExplicitInitialCheck,
  loadResearchBusinessAdmissionContext,
  researchBusinessAdmissionIdempotencySuffix
} from './research-business-policy';
const CHICAGO_TIMEZONE = 'America/Chicago';
const HOURS_TO_MILLISECONDS = 60 * 60 * 1_000;
const DAILY_RESEARCH_PAGE_SIZE = 500;
const SCHEDULED_SOURCE = 'scheduled';
const DAILY_RESEARCH_JOB_TYPE = 'DAILY_RESEARCH' as const;

export { DAILY_RESEARCH_PAGE_SIZE };

type DailyResearchQueryError = {
  readonly code?: string;
  readonly message: string;
};

type EndpointEvidenceRow = {
  readonly candidate_id: string;
  readonly created_at: string;
  readonly id: string;
  readonly kind: string;
};

const endpointResultEvidenceKind = {
  keywords_by_keyword: 'keyword_metrics',
  historical_search_volume: 'historical_search_volume',
  sales_estimates: 'sales_estimates',
  share_of_voice: 'share_of_voice'
} as const satisfies Partial<Record<JungleScoutEndpoint, string>>;

const endpointResultEvidenceKinds = Object.values(endpointResultEvidenceKind);

export interface DailyResearchRunRecord {
  readonly id: string;
  readonly logical_run_date: string;
  readonly locale: string;
  readonly status: string;
  readonly mode?: string;
  readonly selected_candidate_ids: Database['public']['Tables']['research_runs']['Row']['selected_candidate_ids'];
  readonly checkpoint: Database['public']['Tables']['research_runs']['Row']['checkpoint'];
  readonly started_at?: string | null;
  readonly completed_at?: string | null;
}

export interface DailyResearchRunStore {
  readRun(runId: string): Promise<DailyResearchRunRecord | null>;
  publishPlan(
    runId: string,
    selectedCandidateIds: readonly string[],
    checkpoint: Database['public']['Tables']['research_runs']['Row']['checkpoint'],
    startedAt: string
  ): Promise<boolean>;
  updateRun(
    runId: string,
    update: Database['public']['Tables']['research_runs']['Update']
  ): Promise<boolean>;
}

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
  readonly client?: QueueDatabaseClient;
  readonly queue: DailyResearchQueue;
  readonly runStore?: DailyResearchRunStore;
  readonly selectPlan?: (now: Date) => Promise<ResearchPlan>;
  readonly now?: () => Date;
}

export async function collectDailyResearchPages<T>(
  readPage: (
    from: number,
    to: number
  ) => PromiseLike<{
    readonly data: T[] | null;
    readonly error: DailyResearchQueryError | null;
  }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += DAILY_RESEARCH_PAGE_SIZE) {
    const page = await readPage(from, from + DAILY_RESEARCH_PAGE_SIZE - 1);
    if (page.error) {
      throw new DailyResearchError(`Could not read daily research page: ${errorMessage(page.error)}`);
    }
    const pageRows = page.data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < DAILY_RESEARCH_PAGE_SIZE) {
      return rows;
    }
  }
}

export class DailyResearchError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'DailyResearchError';
  }
}

export function canAdvanceDailyResearchCheckpoint(
  current: Pick<DailyResearchRunRecord, 'status' | 'checkpoint'>,
  next: Database['public']['Tables']['research_runs']['Update']
): boolean {
  const nextStatus = next.status ?? current.status;
  const currentParsed = DailyResearchCheckpointSchema.safeParse(current.checkpoint);
  const nextParsed = DailyResearchCheckpointSchema.safeParse(
    next.checkpoint ?? current.checkpoint
  );
  const currentPhase = currentParsed.success ? currentParsed.data.phase : null;
  const nextPhase = nextParsed.success ? nextParsed.data.phase : null;
  const currentCount = currentParsed.success
    ? currentParsed.data.enqueuedCandidateIds.length
    : 0;
  const nextCount = nextParsed.success
    ? nextParsed.data.enqueuedCandidateIds.length
    : 0;

  if (current.status === 'completed' || currentPhase === 'fanout_complete') {
    return (
      nextStatus === 'completed' &&
      nextPhase === 'fanout_complete' &&
      nextCount >= currentCount
    );
  }
  return (
    nextCount >= currentCount &&
    (nextStatus === 'fanout' || nextStatus === 'completed')
  );
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

function freshnessHoursForBucket(
  settings: ResearchSettings,
  bucket: ResearchPlanBucket
): number {
  return bucket === ResearchPlanBucket.new
    ? settings.newFreshnessHours
    : bucket === ResearchPlanBucket.watch
      ? settings.watchFreshnessHours
      : settings.strongFreshnessHours;
}

function isFreshForDuration(
  capturedAt: string | undefined,
  durationMs: number,
  nowMilliseconds: number
): boolean {
  if (!capturedAt) {
    return false;
  }
  const capturedMilliseconds = Date.parse(capturedAt);
  return (
    !Number.isNaN(capturedMilliseconds) &&
    capturedMilliseconds <= nowMilliseconds &&
    nowMilliseconds - capturedMilliseconds < durationMs
  );
}

function latestByCandidateAndKind(
  rows: readonly EndpointEvidenceRow[]
): Map<string, Map<string, EndpointEvidenceRow>> {
  const latest = new Map<string, Map<string, EndpointEvidenceRow>>();
  for (const row of rows) {
    const byKind = latest.get(row.candidate_id) ?? new Map<string, EndpointEvidenceRow>();
    const previous = byKind.get(row.kind);
    if (
      !previous ||
      row.created_at > previous.created_at ||
      (row.created_at === previous.created_at && row.id > previous.id)
    ) {
      byKind.set(row.kind, row);
    }
    latest.set(row.candidate_id, byKind);
  }
  return latest;
}

function admittedRequestedEndpoints(
  businessContext: Awaited<ReturnType<typeof loadResearchBusinessAdmissionContext>>
): JungleScoutEndpoint[] {
  const evidence = businessContext.evidence;
  if (evidence === null) {
    return [];
  }
  return evidence.requestedApiPurposes.filter((requestedEndpoint) =>
    assessResearchApiAdmission({
      assessment: businessContext.assessment,
      evidence,
      requestedEndpoint,
      explicitInitialCheck: isExplicitInitialCheck(evidence, requestedEndpoint)
    }).allowed
  );
}

function missingAdmittedEndpoints(input: {
  readonly admittedEndpoints: readonly JungleScoutEndpoint[];
  readonly endpointEvidence: ReadonlyMap<string, EndpointEvidenceRow> | undefined;
  readonly productSnapshotAt: string | undefined;
  readonly productFreshnessHours: number;
  readonly nowMilliseconds: number;
}): JungleScoutEndpoint[] {
  return input.admittedEndpoints.filter((endpoint) => {
    if (endpoint === 'product_database') {
      return !isFresh(
        input.productSnapshotAt,
        input.productFreshnessHours,
        input.nowMilliseconds
      );
    }
    const evidenceKind = endpointResultEvidenceKind[endpoint];
    const observedAt = evidenceKind
      ? input.endpointEvidence?.get(evidenceKind)?.created_at
      : undefined;
    return !isFreshForDuration(
      observedAt,
      DEFAULT_CACHE_TTL_MS[endpoint],
      input.nowMilliseconds
    );
  });
}

export function snapshotCacheObservationAt(
  metrics: unknown,
  nowMilliseconds: number
): string | undefined {
  if (!metrics || typeof metrics !== 'object' || !('observation' in metrics)) {
    return undefined;
  }
  const observation = metrics.observation;
  if (
    !observation ||
    typeof observation !== 'object' ||
    !('cacheCapturedAt' in observation) ||
    typeof observation.cacheCapturedAt !== 'string'
  ) {
    return undefined;
  }
  const capturedAtMilliseconds = Date.parse(observation.cacheCapturedAt);
  return Number.isFinite(capturedAtMilliseconds) && capturedAtMilliseconds <= nowMilliseconds
    ? observation.cacheCapturedAt
    : undefined;
}

async function selectResearchPlan(
  client: QueueDatabaseClient,
  settings: ResearchSettings,
  now: Date
): Promise<ResearchPlan> {
  const candidates = await collectDailyResearchPages((from, to) =>
    client
      .from('candidates')
      .select('id,state,preliminary_score')
      .in('state', ['Ready for API Validation', 'Watch'])
      .order('id', { ascending: true })
      .range(from, to)
  );

  const actionableCandidates: Array<(typeof candidates)[number]> = [];
  const admittedEndpointsByCandidate = new Map<string, JungleScoutEndpoint[]>();
  for (const candidate of candidates) {
    const businessContext = await loadResearchBusinessAdmissionContext(client, candidate.id, now);
    const admittedEndpoints = admittedRequestedEndpoints(businessContext);
    if (admittedEndpoints.length > 0) {
      actionableCandidates.push(candidate);
      admittedEndpointsByCandidate.set(candidate.id, admittedEndpoints);
    }
  }

  const candidateIds = actionableCandidates.map((candidate) => candidate.id);
  const evidenceRows =
    candidateIds.length === 0
      ? []
      : await collectDailyResearchPages((from, to) =>
          client
            .from('candidate_evidence')
            .select('id,candidate_id,created_at,payload')
            .eq('kind', 'analysis_verdict')
            .in('candidate_id', candidateIds)
            .order('candidate_id', { ascending: true })
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to)
        );
  const latestEvidence = latestByCandidate(evidenceRows);

  const endpointEvidenceRows: EndpointEvidenceRow[] =
    candidateIds.length === 0
      ? []
      : await collectDailyResearchPages((from, to) =>
          client
            .from('candidate_evidence')
            .select('id,candidate_id,created_at,kind')
            .in('candidate_id', candidateIds)
            .in('kind', endpointResultEvidenceKinds)
            .order('candidate_id', { ascending: true })
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to)
        );
  const latestEndpointEvidence = latestByCandidateAndKind(endpointEvidenceRows);

  const snapshotRows =
    candidateIds.length === 0
      ? []
      : await collectDailyResearchPages((from, to) =>
          client
            .from('market_snapshots')
            .select('id,candidate_id,captured_at,metrics')
            .in('candidate_id', candidateIds)
            .order('candidate_id', { ascending: true })
            .order('captured_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to)
        );
  const latestSnapshots = new Map<
    string,
    { readonly cacheCapturedAt: string | undefined; readonly capturedAt: string; readonly id: string }
  >();
  for (const snapshot of snapshotRows) {
    if (!snapshot.candidate_id) {
      continue;
    }
    const previous = latestSnapshots.get(snapshot.candidate_id);
    if (
      !previous ||
      snapshot.captured_at > previous.capturedAt ||
      (snapshot.captured_at === previous.capturedAt && snapshot.id > previous.id)
    ) {
      latestSnapshots.set(snapshot.candidate_id, {
        cacheCapturedAt: snapshotCacheObservationAt(snapshot.metrics, now.getTime()),
        capturedAt: snapshot.captured_at,
        id: snapshot.id
      });
    }
  }

  const nowMilliseconds = now.getTime();
  const dailyCandidates = actionableCandidates.map((candidate) => {
    const strongEvidence = latestEvidence.get(candidate.id);
    const isStrong = strongEvidence
      ? AnalysisVerdictEvidenceSchema.safeParse(strongEvidence.payload).success
      : false;
    const bucket = isStrong
      ? ResearchPlanBucket.strong
      : candidate.state === 'Watch'
        ? ResearchPlanBucket.watch
        : ResearchPlanBucket.new;
    const freshnessHours = freshnessHoursForBucket(settings, bucket);
    const snapshot = latestSnapshots.get(candidate.id);
    const missingEndpoints = missingAdmittedEndpoints({
      admittedEndpoints: admittedEndpointsByCandidate.get(candidate.id) ?? [],
      endpointEvidence: latestEndpointEvidence.get(candidate.id),
      productSnapshotAt: snapshot?.cacheCapturedAt,
      productFreshnessHours: freshnessHours,
      nowMilliseconds
    });
    const capturedAt = missingEndpoints.length > 0 ? undefined : snapshot?.cacheCapturedAt;
    return {
      id: candidate.id,
      bucket,
      informationValue: informationValue(
        candidate.preliminary_score,
        capturedAt,
        freshnessHours,
        nowMilliseconds
      ),
      isFresh: missingEndpoints.length === 0
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

function createDailyResearchRunStore(
  client: QueueDatabaseClient
): DailyResearchRunStore {
  return {
    async readRun(runId) {
      const { data, error } = await client
        .from('research_runs')
        .select(
          'id,logical_run_date,locale,status,mode,selected_candidate_ids,checkpoint,started_at,completed_at'
        )
        .eq('id', runId)
        .maybeSingle();
      if (error) {
        throw new DailyResearchError(
          `Could not read scheduled research run: ${errorMessage(error)}`
        );
      }
      return data;
    },
    async publishPlan(runId, selectedCandidateIds, checkpoint, startedAt) {
      const { data, error } = await client.rpc('publish_daily_research_plan', {
        run_id: runId,
        plan_candidate_ids: [...selectedCandidateIds],
        plan_checkpoint: checkpoint,
        plan_started_at: startedAt
      });
      if (error) {
        throw new DailyResearchError(
          `Could not publish daily research plan: ${errorMessage(error)}`
        );
      }
      return data;
    },
    async updateRun(runId, update) {
      return createMigration019CompatibilityRepository(
        client
      ).advanceDailyResearchCheckpoint({
        runId,
        nextStatus: update.status ?? '',
        nextCheckpoint: update.checkpoint ?? {},
        nextCompletedAt: update.completed_at ?? null
      });
    }
  };
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

async function persistDailyResearchCheckpoint(
  runStore: DailyResearchRunStore,
  runId: string,
  update: Database['public']['Tables']['research_runs']['Update']
): Promise<DailyResearchCheckpoint | undefined> {
  if (await runStore.updateRun(runId, update)) {
    return undefined;
  }
  const latest = await runStore.readRun(runId);
  const adopted = latest
    ? checkpointFromRun(latest.selected_candidate_ids, latest.checkpoint)
    : null;
  if (latest?.status === 'completed' && adopted?.phase === 'fanout_complete') {
    return adopted;
  }
  throw new DailyResearchError('Rejected stale daily research checkpoint write.');
}

function isUnpublishedRun(run: DailyResearchRunRecord): boolean {
  const parsedIds = DailyResearchSelectedCandidateIdsSchema.safeParse(
    run.selected_candidate_ids
  );
  if (!parsedIds.success || parsedIds.data.length > 0) {
    return false;
  }
  if (
    typeof run.checkpoint !== 'object' ||
    run.checkpoint === null ||
    Array.isArray(run.checkpoint)
  ) {
    return false;
  }
  return Object.keys(run.checkpoint).length === 0;
}

function childPayload(
  item: ResearchPlanItem,
  locale: DailyResearchJobPayload['locale'],
  researchRunId: string,
  mode: string | undefined
): ScheduledMarketProbePayload {
  return ScheduledMarketProbePayloadSchema.parse({
    candidateId: item.id,
    locale,
    researchRunId,
    purpose:
      mode === 'override-reserve' || item.bucket === ResearchPlanBucket.strong
        ? 'strong_revalidation'
        : 'normal_validation'
  });
}

async function loadMissingAdmittedEndpoints(
  client: QueueDatabaseClient,
  candidateId: string,
  admittedEndpoints: readonly JungleScoutEndpoint[],
  bucket: ResearchPlanBucket,
  now: Date
): Promise<JungleScoutEndpoint[]> {
  const [settings, endpointEvidenceResult, snapshotResult] = await Promise.all([
    readSettings(client),
    client
      .from('candidate_evidence')
      .select('id,candidate_id,created_at,kind')
      .eq('candidate_id', candidateId)
      .in('kind', endpointResultEvidenceKinds)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
    client
      .from('market_snapshots')
      .select('id,captured_at,metrics')
      .eq('candidate_id', candidateId)
      .order('captured_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);
  if (endpointEvidenceResult.error) {
    throw new DailyResearchError(
      `Could not read endpoint evidence: ${errorMessage(endpointEvidenceResult.error)}`
    );
  }
  if (snapshotResult.error) {
    throw new DailyResearchError(
      `Could not read Product Database snapshot: ${errorMessage(snapshotResult.error)}`
    );
  }
  const endpointEvidence = latestByCandidateAndKind(
    endpointEvidenceResult.data ?? []
  ).get(candidateId);
  return missingAdmittedEndpoints({
    admittedEndpoints,
    endpointEvidence,
    productSnapshotAt: snapshotCacheObservationAt(snapshotResult.data?.metrics, now.getTime()),
    productFreshnessHours: freshnessHoursForBucket(settings, bucket),
    nowMilliseconds: now.getTime()
  });
}

async function enqueueDecisionAwareChild(
  client: QueueDatabaseClient,
  queue: DailyResearchQueue,
  item: ResearchPlanItem,
  locale: DailyResearchJobPayload['locale'],
  researchRunId: string,
  mode: string | undefined,
  now: Date
): Promise<void> {
  const businessContext = await loadResearchBusinessAdmissionContext(client, item.id);
  const admittedEndpoints = admittedRequestedEndpoints(businessContext);
  if (admittedEndpoints.length === 0) {
    return;
  }
  const missingEndpoints = await loadMissingAdmittedEndpoints(
    client,
    item.id,
    admittedEndpoints,
    item.bucket,
    now
  );

  const idempotencyPrefix = `daily-research:${researchRunId}:${item.bucket}:${item.id}`;
  if (missingEndpoints.includes('product_database')) {
    await queue.enqueueJob({
      type: 'MARKET_PROBE',
      payload: childPayload(item, locale, researchRunId, mode),
      idempotencyKey: idempotencyPrefix
    });
    return;
  }

  const suffix = researchBusinessAdmissionIdempotencySuffix(businessContext);
  if (suffix === null) {
    return;
  }
  if (missingEndpoints.includes('keywords_by_keyword')) {
    await queue.enqueueJob({
      type: 'DEEP_VALIDATION',
      payload: DeepValidationJobPayloadSchema.parse({ candidateId: item.id, locale }),
      idempotencyKey: `${idempotencyPrefix}:deep:${suffix}`
    });
  }
  if (
    missingEndpoints.includes('historical_search_volume') ||
    missingEndpoints.includes('sales_estimates') ||
    missingEndpoints.includes('share_of_voice')
  ) {
    await queue.enqueueJob({
      type: 'ENRICH_STRONG_POTENTIAL',
      payload: EnrichStrongPotentialJobPayloadSchema.parse({ candidateId: item.id, locale }),
      idempotencyKey: `${idempotencyPrefix}:enrich:${suffix}`
    });
  }
}

async function enqueueEligibleNormalizationJobs(
  client: QueueDatabaseClient,
  locale: Locale
): Promise<void> {
  const candidates = await collectDailyResearchPages((from, to) =>
    client
      .from('candidates')
      .select('id')
      .eq('state', 'AI Screening')
      .eq('eligible_for_ai_normalization', true)
      .order('id', { ascending: true })
      .range(from, to)
  );
  for (const candidate of candidates) {
    const { error } = await client.rpc('enqueue_initial_candidate_normalization', {
      candidate_id: candidate.id,
      locale,
      writer_mode: 'canonical'
    });
    if (error) {
      throw new DailyResearchError(`Failed to enqueue candidate normalization: ${error.message}`);
    }
  }
  await createNormalizationRearmRepository(client).rearmWaitingCandidates(locale);
}


async function enqueueDigestBestEffort(
  dependencies: RunDailyResearchDependencies,
  researchRunId: string,
  locale: Locale,
  checkpoint: DailyResearchCheckpoint
): Promise<DailyResearchCheckpoint> {
  try {
    await dependencies.queue.enqueueJob({
      type: 'SEND_DIGEST',
      payload: { researchRunId },
      idempotencyKey: `send-digest:${researchRunId}`
    });
    if (dependencies.client) {
      await dependencies.client.from('notifications').insert({
        research_run_id: researchRunId,
        event_type: 'DAILY_SUMMARY',
        locale,
        idempotency_key: `daily-summary:${researchRunId}`,
        payload: { researchRunId, summary: `research run ${researchRunId}` }
      });
    }
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
  }
  return checkpoint;
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

  let runStore = dependencies.runStore;
  if (!runStore) {
    if (!dependencies.client) {
      throw new DailyResearchError('Daily research requires a database client.');
    }
    runStore = createDailyResearchRunStore(dependencies.client);
  }
  const run = await runStore.readRun(payload.researchRunId);
  if (
    !run ||
    run.logical_run_date !== payload.logicalRunDate ||
    LocaleSchema.parse(run.locale) !== payload.locale
  ) {
    throw new DailyResearchError('Daily research job payload does not match its durable run.');
  }

  let checkpoint = checkpointFromRun(run.selected_candidate_ids, run.checkpoint);
  if (!checkpoint) {
    if (!isUnpublishedRun(run)) {
      throw new DailyResearchError(
        'Daily research run has an invalid or partially persisted plan.'
      );
    }
    let plan: ResearchPlan;
    if (dependencies.selectPlan) {
      plan = await dependencies.selectPlan(now);
    } else {
      if (!dependencies.client) {
        throw new DailyResearchError('Daily research planning requires a database client.');
      }
      const settings = await readSettings(dependencies.client);
      plan = await selectResearchPlan(dependencies.client, settings, now);
    }
    const selectedCandidateIds = plan.items.map((item) => item.id);
    const candidateCheckpoint: DailyResearchCheckpoint = {
      phase: 'fanout',
      selectedItems: [...plan.items],
      enqueuedCandidateIds: []
    };
    const published = await runStore.publishPlan(
      run.id,
      selectedCandidateIds,
      candidateCheckpoint,
      now.toISOString()
    );
    const persistedRun = await runStore.readRun(run.id);
    checkpoint = persistedRun
      ? checkpointFromRun(
          persistedRun.selected_candidate_ids,
          persistedRun.checkpoint
        )
      : null;
    if (!checkpoint) {
      throw new DailyResearchError(
        published
          ? 'Daily research plan was published but could not be re-read before fanout.'
          : 'Daily research plan was not persisted by this worker.'
      );
    }
  }
  if (!checkpoint) {
    throw new DailyResearchError('Daily research selection checkpoint was not created.');
  }

  if (dependencies.client) {
    await enqueueEligibleNormalizationJobs(dependencies.client, payload.locale);
  }

  const enqueuedCandidateIds = new Set(checkpoint.enqueuedCandidateIds);
  for (const item of checkpoint.selectedItems) {
    if (enqueuedCandidateIds.has(item.id)) {
      continue;
    }
    if (dependencies.client) {
      await enqueueDecisionAwareChild(
        dependencies.client,
        dependencies.queue,
        item,
        payload.locale,
        run.id,
        run.mode,
        now
      );
    } else {
      await dependencies.queue.enqueueJob({
        type: 'MARKET_PROBE',
        payload: childPayload(item, payload.locale, run.id, run.mode),
        idempotencyKey: `daily-research:${run.id}:${item.bucket}:${item.id}`
      });
    }
    enqueuedCandidateIds.add(item.id);
    checkpoint = {
      phase: 'fanout',
      selectedItems: checkpoint.selectedItems,
      enqueuedCandidateIds: [...enqueuedCandidateIds]
    };
    const adopted = await persistDailyResearchCheckpoint(runStore, run.id, {
      status: 'fanout',
      checkpoint
    });
    if (adopted) {
      return enqueueDigestBestEffort(dependencies, run.id, payload.locale, adopted);
    }
  }

  checkpoint = {
    phase: 'fanout_complete',
    selectedItems: checkpoint.selectedItems,
    enqueuedCandidateIds: [...enqueuedCandidateIds]
  };
  const completed = await persistDailyResearchCheckpoint(runStore, run.id, {
    status: 'completed',
    completed_at: now.toISOString(),
    checkpoint
  });
  return enqueueDigestBestEffort(
    dependencies,
    run.id,
    payload.locale,
    completed ?? checkpoint
  );
}

export function createDailyResearchHandler(
  client: QueueDatabaseClient,
  queue: DailyResearchQueue | DurableQueue
): (job: Job) => Promise<DailyResearchCheckpoint> {
  return (job) => runDailyResearch(job, { client, queue });
}
