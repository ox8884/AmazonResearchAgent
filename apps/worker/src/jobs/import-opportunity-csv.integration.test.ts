import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServerDatabaseClient } from '@ara/db';
import { afterEach, describe, expect, it } from 'vitest';
import {
  runImportJob,
  type ImportCheckpoint,
  type ImportSourceFile
} from './import-opportunity-csv';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const integration = supabaseUrl && serviceRoleKey ? describe : describe.skip;

function fixture(name: string): ImportSourceFile {
  const path = fileURLToPath(
    new URL(`../../../../tests/fixtures/opportunity-finder/${name}`, import.meta.url)
  );
  return {
    sourceFileName: name,
    content: readFileSync(path, 'utf8')
  };
}

integration('Opportunity Finder import job', () => {
  const client = createServerDatabaseClient({
    url: supabaseUrl ?? 'http://127.0.0.1:54321',
    serviceRoleKey: serviceRoleKey ?? 'integration-test-not-configured'
  });
  const files = [fixture('page-1.csv'), fixture('page-2.csv')];

  async function createImportRun(): Promise<string> {
    const { data, error } = await client
      .from('import_runs')
      .insert({
        status: 'queued',
        locale: 'ko',
        submission_hash: `worker-it-${crypto.randomUUID()}`,
        file_count: files.length,
        source_files: files.map((file) => ({ name: file.sourceFileName }))
      })
      .select('id')
      .single();
    if (error || !data) {
      throw error ?? new Error('Expected import run id');
    }
    return data.id;
  }

  afterEach(async () => {
    const { error } = await client
      .from('import_runs')
      .delete()
      .like('submission_hash', 'worker-it-%');
    if (error) {
      throw error;
    }
  });

  // Break: files are processed independently, duplicate candidates remain, or Reject lacks reasons.
  it('merges two files, deduplicates exact keywords, and persists rejection reasons', async () => {
    const importRunId = await createImportRun();
    const result = await runImportJob(
      { importRunId, files },
      { client }
    );

    expect(result).toMatchObject({
      importRunId,
      fileCount: 2,
      totalRowCount: 8,
      uniqueKeywordCount: 7,
      duplicateKeywordCount: 1,
      rejectedCount: 4,
      acceptedCount: 3
    });

    const { count: rawCount, error: rawError } = await client
      .from('raw_opportunity_keywords')
      .select('*', { count: 'exact', head: true })
      .eq('import_run_id', importRunId);
    if (rawError) {
      throw rawError;
    }
    expect(rawCount).toBe(8);

    const { data: rejected, error: candidateError } = await client
      .from('candidates')
      .select('keyword, rule_reasons')
      .eq('import_run_id', importRunId)
      .eq('state', 'Reject');
    if (candidateError) {
      throw candidateError;
    }
    const electric = rejected.find((candidate) => candidate.keyword === 'electric can opener');
    expect(electric?.rule_reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ELECTRIC_OR_BATTERY' })
      ])
    );
    expect(
      rejected.every(
        (candidate) =>
          Array.isArray(candidate.rule_reasons) &&
          candidate.rule_reasons.length > 0
      )
    ).toBe(true);
  });

  // Break: retry after a persisted-raw crash duplicates rows, candidates, or audit histories.
  it('resumes a forced crash without duplicate downstream records', async () => {
    const importRunId = await createImportRun();
    let crashed = false;
    const checkpoints: ImportCheckpoint[] = [];

    await expect(
      runImportJob(
        { importRunId, files },
        {
          client,
          async onCheckpoint(checkpoint) {
            checkpoints.push(checkpoint);
            if (checkpoint.phase === 'persisted_raw' && !crashed) {
              crashed = true;
              throw new Error('forced crash after raw persistence');
            }
          }
        }
      )
    ).rejects.toThrow('forced crash');

    const completed = await runImportJob(
      { importRunId, files },
      { client }
    );
    expect(completed.checkpoint.phase).toBe('completed');
    expect(checkpoints.some((checkpoint) => checkpoint.phase === 'persisted_raw')).toBe(true);

    const { data: candidateRows, error: candidateRowsError } = await client
      .from('candidates')
      .select('id')
      .eq('import_run_id', importRunId);
    if (candidateRowsError) {
      throw candidateRowsError;
    }
    const candidateIds = candidateRows.map((candidate) => candidate.id);
    const [rawRows, candidates, decisions, scores] = await Promise.all([
      client
        .from('raw_opportunity_keywords')
        .select('*', { count: 'exact', head: true })
        .eq('import_run_id', importRunId),
      client
        .from('candidates')
        .select('*', { count: 'exact', head: true })
        .eq('import_run_id', importRunId),
      client
        .from('decision_history')
        .select('*', { count: 'exact', head: true })
        .in('candidate_id', candidateIds),
      client
        .from('score_history')
        .select('*', { count: 'exact', head: true })
        .in('candidate_id', candidateIds)
    ]);
    for (const result of [rawRows, candidates, decisions, scores]) {
      if (result.error) {
        throw result.error;
      }
    }

    expect(rawRows.count).toBe(8);
    expect(candidates.count).toBe(7);
    expect(decisions.count).toBe(7);
    expect(scores.count).toBe(7);
  });
});
