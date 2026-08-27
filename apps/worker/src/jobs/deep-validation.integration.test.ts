import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createServerDatabaseClient } from '@ara/db';
import { runDeepValidation } from './deep-validation';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const integration = supabaseUrl && serviceRoleKey ? describe : describe.skip;

function database() {
  return createServerDatabaseClient({
    url: supabaseUrl ?? 'http://127.0.0.1:54321',
    serviceRoleKey: serviceRoleKey ?? 'integration-test-not-configured'
  });
}

integration('deep validation job', () => {
  const client = database();
  const importRuns: string[] = [];

  afterEach(async () => {
    for (const importRunId of importRuns.splice(0)) {
      await client.from('import_runs').delete().eq('id', importRunId);
    }
  });

  async function seedCandidate(state: 'Reject' | 'Watch'): Promise<string> {
    const importRunId = randomUUID();
    const rawId = randomUUID();
    const candidateId = randomUUID();
    importRuns.push(importRunId);
    const { error: importError } = await client.from('import_runs').insert({
      id: importRunId,
      submission_hash: `deep-${importRunId}`,
      file_count: 1,
      total_row_count: 1,
      unique_keyword_count: 1,
      source_files: []
    });
    if (importError) throw importError;
    const { error: rawError } = await client.from('raw_opportunity_keywords').insert({
      id: rawId,
      import_run_id: importRunId,
      source_file_name: 'deep.csv',
      source_hash: `deep-${importRunId}`,
      source_row_number: 1,
      row_hash: `deep-row-${importRunId}`,
      raw_row_text: 'sink splash guard',
      raw_row: { Keyword: 'sink splash guard' },
      parsed_row: { keyword: 'sink splash guard' },
      keyword: 'sink splash guard',
      normalized_exact_keyword: 'sink splash guard',
      is_exact_duplicate: false
    });
    if (rawError) throw rawError;
    const { error: candidateError } = await client.from('candidates').insert({
      id: candidateId,
      import_run_id: importRunId,
      representative_raw_keyword_id: rawId,
      keyword: 'sink splash guard',
      normalized_exact_keyword: 'sink splash guard',
      state,
      rule_passed: true,
      rule_reasons: [],
      risk_flags: [],
      preliminary_score: 60,
      preliminary_score_components: {},
      eligible_for_ai_normalization: true
    });
    if (candidateError) throw candidateError;
    return candidateId;
  }

  it('does not spend Level 2 calls on a Level 1 Reject', async () => {
    const candidateId = await seedCandidate('Reject');
    const result = await runDeepValidation(candidateId, 'ko', { client });
    const { data: usage } = await client
      .from('api_usage')
      .select('id')
      .eq('candidate_id', candidateId)
      .eq('endpoint', 'keywords_by_keyword');
    expect(result.keywordCalls).toBe(0);
    expect(usage).toHaveLength(0);
  });
});
