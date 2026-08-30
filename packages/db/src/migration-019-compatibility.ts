import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from './types';

type GeneratedFunctions = Database['public']['Functions'];

type Migration019CompatibilityDatabase = {
  public: {
    Tables: Database['public']['Tables'];
    Views: Database['public']['Views'];
    Functions: {
      advance_daily_research_checkpoint: {
        Args: Omit<
          GeneratedFunctions['advance_daily_research_checkpoint']['Args'],
          'next_completed_at'
        > & {
          next_completed_at: string | null;
        };
        Returns: GeneratedFunctions['advance_daily_research_checkpoint']['Returns'];
      };
      upsert_niche_cluster: {
        Args: Omit<GeneratedFunctions['upsert_niche_cluster']['Args'], 'canonical_english'> & {
          canonical_english: string | null;
        };
        Returns: GeneratedFunctions['upsert_niche_cluster']['Returns'];
      };
    };
    Enums: Database['public']['Enums'];
    CompositeTypes: Database['public']['CompositeTypes'];
  };
};

type CompatibilityRpc = SupabaseClient<Migration019CompatibilityDatabase>['rpc'];

export type AdvanceDailyResearchCheckpointInput = {
  readonly runId: string;
  readonly nextStatus: string;
  readonly nextCheckpoint: Json;
  readonly nextCompletedAt: string | null;
};

export type UpsertNicheClusterInput = {
  readonly canonicalKey: string;
  readonly canonicalName: string;
  readonly canonicalEnglish: string | null;
  readonly aliases: Json;
  readonly catalogPhrases: Json;
  readonly clusterState: string;
};

export interface Migration019CompatibilityRepository {
  advanceDailyResearchCheckpoint(
    input: AdvanceDailyResearchCheckpointInput
  ): Promise<boolean>;
  upsertNicheCluster(input: UpsertNicheClusterInput): Promise<string>;
}

export class Migration019CompatibilityError extends Error {
  constructor(operation: string, cause?: unknown) {
    super(`Could not ${operation}.`, { cause });
    this.name = 'Migration019CompatibilityError';
  }
}

export function createMigration019CompatibilityRepository(
  client: Pick<SupabaseClient<Database>, 'rpc'>
): Migration019CompatibilityRepository {
  // Supabase CLI 2.116.0 loses SQL argument nullability for these two no-default RPCs.
  const rpc = client.rpc.bind(client) as CompatibilityRpc;

  return {
    async advanceDailyResearchCheckpoint(input) {
      const { data, error } = await rpc('advance_daily_research_checkpoint', {
        run_id: input.runId,
        next_status: input.nextStatus,
        next_checkpoint: input.nextCheckpoint,
        next_completed_at: input.nextCompletedAt
      });
      if (error) {
        throw new Migration019CompatibilityError('advance daily research checkpoint', error);
      }
      return data;
    },

    async upsertNicheCluster(input) {
      const { data, error } = await rpc('upsert_niche_cluster', {
        canonical_key: input.canonicalKey,
        canonical_name: input.canonicalName,
        canonical_english: input.canonicalEnglish,
        aliases: input.aliases,
        catalog_phrases: input.catalogPhrases,
        cluster_state: input.clusterState
      });
      if (error || data === null) {
        throw new Migration019CompatibilityError('upsert niche cluster', error);
      }
      return data;
    }
  };
}
