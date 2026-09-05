import { z } from 'zod';
import { getServerDatabaseContext } from './database';
import { DashboardQueryError, safe } from './dashboard-query';

const IDS = z.array(z.uuid());
const JOB_LIMIT = 200;

async function loadRun(id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const { client } = getServerDatabaseContext();
  const [{ data: run, error }, { data: jobs, error: jobsError }] = await Promise.all([
    client.from('research_runs').select('id,source,status,logical_run_date,started_at,completed_at,updated_at,selected_candidate_ids').eq('id', id).maybeSingle(),
    client.from('jobs').select('id,type,status,created_at,updated_at,leased_until,attempts,max_attempts')
      .contains('payload', { researchRunId: id }).order('created_at', { ascending: false }).limit(JOB_LIMIT + 1)
  ]);
  if (error) throw new DashboardQueryError('research run', error);
  if (jobsError) throw new DashboardQueryError('run jobs', jobsError);
  if (!run) return null;
  const parsed = IDS.safeParse(run.selected_candidate_ids);
  const candidateIds = parsed.success ? [...new Set(parsed.data)] : [];
  const candidates = candidateIds.length > 0
    ? await client.from('candidates').select('id,keyword,state').in('id', candidateIds)
    : { data: [], error: null };
  if (candidates.error) throw new DashboardQueryError('run candidates', candidates.error);
  return { run, candidates: candidates.data, selectedIdsValid: parsed.success,
    jobs: jobs.slice(0, JOB_LIMIT), jobsTruncated: jobs.length > JOB_LIMIT };
}

export function getResearchRunDetail(id: string) {
  return safe(() => loadRun(id), null);
}

export async function getActiveQueueJobs() {
  return safe(async () => {
    const { client } = getServerDatabaseContext();
    const { data, error } = await client.from('jobs')
      .select('id,type,status,created_at,updated_at,leased_until,attempts,max_attempts')
      .in('status', ['running', 'failed']).order('updated_at', { ascending: false }).limit(51);
    if (error) throw new DashboardQueryError('active queue jobs', error);
    return { jobs: data.slice(0, 50), truncated: data.length > 50 };
  }, null);
}
