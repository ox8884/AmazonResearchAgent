import { describe, expect, it, vi } from 'vitest';
import { createMigration019CompatibilityRepository } from './migration-019-compatibility';

describe('migration 019 compatibility repository', () => {
  // Break: the generated RPC typing workaround replaces a legitimate SQL NULL with another value.
  it('forwards null daily completion unchanged', async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const repository = createMigration019CompatibilityRepository({ rpc } as never);

    await expect(
      repository.advanceDailyResearchCheckpoint({
        runId: 'run-a',
        nextStatus: 'fanout',
        nextCheckpoint: { phase: 'fanout' },
        nextCompletedAt: null
      })
    ).resolves.toBe(true);

    expect(rpc).toHaveBeenCalledWith('advance_daily_research_checkpoint', {
      run_id: 'run-a',
      next_status: 'fanout',
      next_checkpoint: { phase: 'fanout' },
      next_completed_at: null
    });
  });

  // Break: nullable canonical English is omitted or fabricated at the compatibility boundary.
  it('forwards null canonical English unchanged', async () => {
    const rpc = vi.fn(async () => ({ data: 'cluster-a', error: null }));
    const repository = createMigration019CompatibilityRepository({ rpc } as never);

    await expect(
      repository.upsertNicheCluster({
        canonicalKey: 'batter dispenser',
        canonicalName: 'Batter Dispenser',
        canonicalEnglish: null,
        aliases: [],
        catalogPhrases: [],
        clusterState: 'Ready for API Validation'
      })
    ).resolves.toBe('cluster-a');

    expect(rpc).toHaveBeenCalledWith('upsert_niche_cluster', {
      canonical_key: 'batter dispenser',
      canonical_name: 'Batter Dispenser',
      canonical_english: null,
      aliases: [],
      catalog_phrases: [],
      cluster_state: 'Ready for API Validation'
    });
  });
});
