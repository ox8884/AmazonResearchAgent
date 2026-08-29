import { createQueue } from '@ara/queue';
import {
  DailyResearchJobPayloadSchema,
  LocaleSchema,
  LogicalRunDateSchema,
  ResearchNowModeSchema,
  type Locale,
  type LogicalRunDate,
  type ResearchNowMode
} from '@ara/shared';
import { getServerDatabaseContext } from './database';

const CHICAGO_TIMEZONE = 'America/Chicago';
const MANUAL_SOURCE = 'manual';
const ACTIVE_RUN_STATUSES = [
  'queued',
  'planning',
  'fanout',
  'running',
  'waiting'
] as const;

export class ResearchNowEnqueueError extends Error {
  constructor(operation: string, cause?: unknown) {
    super(`Could not ${operation}.`, { cause });
    this.name = 'ResearchNowEnqueueError';
  }
}

export type ResearchNowResult = {
  readonly researchRunId: string;
};

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

export async function enqueueResearchNow(
  mode: ResearchNowMode,
  now = new Date()
): Promise<ResearchNowResult> {
  const parsedMode = ResearchNowModeSchema.parse(mode);
  const { client } = getServerDatabaseContext();
  const queue = createQueue(client);
  const logicalRunDate = deriveChicagoDate(now);

  const { data: settings, error: settingsError } = await client
    .from('app_settings')
    .select('locale')
    .eq('id', true)
    .maybeSingle();
  if (settingsError) {
    throw new ResearchNowEnqueueError('read app settings', settingsError);
  }
  const locale: Locale = LocaleSchema.parse(settings?.locale ?? 'ko');

  const { data: activeRun, error: activeError } = await client
    .from('research_runs')
    .select('id')
    .eq('source', MANUAL_SOURCE)
    .eq('logical_run_date', logicalRunDate)
    .eq('mode', parsedMode)
    .in('status', [...ACTIVE_RUN_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeError) {
    throw new ResearchNowEnqueueError('find an in-flight research run', activeError);
  }
  if (activeRun) {
    return { researchRunId: activeRun.id };
  }

  const { data: inserted, error: insertError } = await client
    .from('research_runs')
    .insert({
      source: MANUAL_SOURCE,
      mode: parsedMode,
      logical_run_date: logicalRunDate,
      locale,
      timezone: CHICAGO_TIMEZONE,
      idempotency_key: `research-now:${crypto.randomUUID()}`
    })
    .select('id')
    .single();
  if (insertError || !inserted) {
    throw new ResearchNowEnqueueError(
      'create a manual research run',
      insertError ?? new Error('no row returned')
    );
  }

  try {
    await queue.enqueueJob({
      type: 'DAILY_RESEARCH',
      payload: DailyResearchJobPayloadSchema.parse({
        researchRunId: inserted.id,
        logicalRunDate,
        locale
      }),
      idempotencyKey: `research-now:${inserted.id}`
    });
  } catch (error) {
    await client.from('research_runs').delete().eq('id', inserted.id);
    throw new ResearchNowEnqueueError('enqueue the research job', error);
  }

  return { researchRunId: inserted.id };
}
