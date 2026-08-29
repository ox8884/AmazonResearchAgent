import { pathToFileURL } from 'node:url';
import { createServerDatabaseClient } from '@ara/db';
import {
  deriveChicagoDate,
  enqueueDailyResearch,
  parseLogicalRunDate
} from '../jobs/daily-research';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
export function requestedDailyDate(
  argument: string | undefined,
  now = new Date()
): string {
  return argument ? parseLogicalRunDate(argument) : deriveChicagoDate(now);
}

export async function enqueueDailyFromEnvironment(
  argument: string | undefined = process.argv[2]
): Promise<void> {
  const logicalRunDate = requestedDailyDate(argument);
  const client = createServerDatabaseClient({
    url: requiredEnvironment('SUPABASE_URL'),
    serviceRoleKey: requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY')
  });
  const result = await enqueueDailyResearch(client, { logicalRunDate });
  console.info(
    `Enqueued daily research for ${result.logicalRunDate} ` +
      `(run ${result.researchRunId}, job ${result.jobId}).`
  );
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  enqueueDailyFromEnvironment().catch((error: unknown) => {
    if (error instanceof Error) {
      console.error(`Daily enqueue stopped: ${error.message}`);
    } else {
      console.error('Daily enqueue stopped: Unknown error');
    }
    process.exitCode = 1;
  });
}
