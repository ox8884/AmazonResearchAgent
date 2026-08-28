import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createServerDatabaseClient } from '@ara/db';
import { runEnrichStrongPotential } from './enrich-strong-potential';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const integration = supabaseUrl && serviceRoleKey ? describe : describe.skip;

function database() {
  return createServerDatabaseClient({
    url: supabaseUrl ?? 'http://127.0.0.1:54321',
    serviceRoleKey: serviceRoleKey ?? 'integration-test-not-configured'
  });
}

integration('strong potential enrichment', () => {
  const client = database();
  const importRuns: string[] = [];

  afterEach(async () => {
    for (const importRunId of importRuns.splice(0)) {
      await client.from('import_runs').delete().eq('id', importRunId);
    }
  });

  it('does not fabricate economics or listing_proxy evidence', async () => {
    const importRunId = randomUUID();
    const rawId = randomUUID();
    const candidateId = randomUUID();
    importRuns.push(importRunId);
    const { error: importError } = await client.from('import_runs').insert({
      id: importRunId,
      submission_hash: `enrich-${importRunId}`,
      file_count: 1,
      total_row_count: 1,
      unique_keyword_count: 1,
      source_files: []
    });
    if (importError) throw importError;
    const { error: rawError } = await client.from('raw_opportunity_keywords').insert({
      id: rawId,
      import_run_id: importRunId,
      source_file_name: 'enrich.csv',
      source_hash: `enrich-${importRunId}`,
      source_row_number: 1,
      row_hash: `enrich-row-${importRunId}`,
      raw_row_text: 'faucet mat',
      raw_row: { Keyword: 'faucet mat' },
      parsed_row: { keyword: 'faucet mat' },
      keyword: 'faucet mat',
      normalized_exact_keyword: 'faucet mat',
      is_exact_duplicate: false
    });
    if (rawError) throw rawError;
    const { error: candidateError } = await client.from('candidates').insert({
      id: candidateId,
      import_run_id: importRunId,
      representative_raw_keyword_id: rawId,
      keyword: 'faucet mat',
      normalized_exact_keyword: 'faucet mat',
      state: 'Watch',
      rule_passed: true,
      rule_reasons: [],
      risk_flags: [],
      preliminary_score: 70,
      preliminary_score_components: {},
      eligible_for_ai_normalization: true
    });
    if (candidateError) throw candidateError;

    const result = await runEnrichStrongPotential(candidateId, client);
    const { data: evidence } = await client
      .from('candidate_evidence')
      .select('payload')
      .eq('candidate_id', candidateId)
      .eq('kind', 'economics')
      .maybeSingle();

    expect(result.differentiationMode).toBe('missing');
    expect(evidence).toBeNull();
  });
});
