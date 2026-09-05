import {
  LogicalRunDateSchema,
  ResearchNowModeSchema,
  type LogicalRunDate,
  type ResearchNowMode
} from '@ara/shared';
import { getServerDatabaseContext } from './database';

const CHICAGO_TIMEZONE = 'America/Chicago';
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
  const logicalRunDate = deriveChicagoDate(now);
  const { data: researchRunId, error } = await client.rpc('enqueue_manual_research', {
    logical_date: logicalRunDate,
    research_mode: parsedMode
  });
  if (error || !researchRunId) {
    throw new ResearchNowEnqueueError(
      'enqueue manual research',
      error ?? new Error('no research run returned')
    );
  }

  return { researchRunId };
}
