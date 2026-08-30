import type { Locale } from '@ara/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from './types';

const REARM_PAGE_SIZE = 500;

type NormalizationRearmClient = Pick<SupabaseClient<Database>, 'from' | 'rpc'>;

export type RearmCandidateNormalizationInput = {
  readonly candidateId: string;
  readonly expectedNormalizationGeneration: number;
  readonly locale: Locale;
};

export type NormalizationRearmResult = {
  readonly jobId: string;
  readonly idempotencyKey: string;
  readonly normalizationGeneration: number;
};

export interface NormalizationRearmRepository {
  rearm(input: RearmCandidateNormalizationInput): Promise<NormalizationRearmResult>;
  rearmWaitingCandidates(locale: Locale): Promise<readonly NormalizationRearmResult[]>;
}

export class NormalizationRearmRepositoryError extends Error {
  readonly authorityMessage: string | null;

  constructor(operation: string, cause?: unknown, authorityMessage: string | null = null) {
    super(`Could not ${operation}.`, { cause });
    this.name = 'NormalizationRearmRepositoryError';
    this.authorityMessage = authorityMessage;
  }
}

function resultObject(
  value: Json | null,
  operation: string
): { [key: string]: Json | undefined } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new NormalizationRearmRepositoryError(operation);
  }
  return value;
}

function parseResult(value: Json | null): NormalizationRearmResult {
  const operation = 'rearm candidate normalization';
  const result = resultObject(value, operation);
  if (
    typeof result.job_id !== 'string' ||
    typeof result.idempotency_key !== 'string' ||
    typeof result.normalization_generation !== 'number' ||
    !Number.isSafeInteger(result.normalization_generation) ||
    result.normalization_generation < 1
  ) {
    throw new NormalizationRearmRepositoryError(operation);
  }
  return {
    jobId: result.job_id,
    idempotencyKey: result.idempotency_key,
    normalizationGeneration: result.normalization_generation
  };
}

const EXPECTED_SWEEP_REJECTIONS = new Set([
  'normalization_rearm_candidate_rejected',
  'normalization_rearm_active_job',
  'normalization_rearm_active_analysis',
  'normalization_rearm_provider_unavailable'
]);

export function createNormalizationRearmRepository(
  client: NormalizationRearmClient
): NormalizationRearmRepository {
  const rearm = async (
    input: RearmCandidateNormalizationInput
  ): Promise<NormalizationRearmResult> => {
    const operation = 'rearm candidate normalization';
    const { data, error } = await client.rpc('rearm_candidate_normalization', {
      candidate_id: input.candidateId,
      expected_candidate_state: 'Waiting for AI Capacity',
      expected_normalization_generation: input.expectedNormalizationGeneration,
      locale: input.locale
    });
    if (error) {
      throw new NormalizationRearmRepositoryError(operation, error, error.message);
    }
    return parseResult(data);
  };

  return {
    rearm,

    async rearmWaitingCandidates(locale) {
      const results: NormalizationRearmResult[] = [];
      for (let from = 0; ; from += REARM_PAGE_SIZE) {
        const { data, error } = await client
          .from('candidates')
          .select('id,normalization_generation')
          .eq('state', 'Waiting for AI Capacity')
          .eq('eligible_for_ai_normalization', true)
          .order('id', { ascending: true })
          .range(from, from + REARM_PAGE_SIZE - 1);
        if (error) {
          throw new NormalizationRearmRepositoryError(
            'read Waiting normalization candidates',
            error
          );
        }
        for (const candidate of data) {
          try {
            results.push(await rearm({
              candidateId: candidate.id,
              expectedNormalizationGeneration: candidate.normalization_generation,
              locale
            }));
          } catch (error) {
            if (
              error instanceof NormalizationRearmRepositoryError &&
              error.authorityMessage !== null &&
              EXPECTED_SWEEP_REJECTIONS.has(error.authorityMessage)
            ) {
              continue;
            }
            throw error;
          }
        }
        if (data.length < REARM_PAGE_SIZE) return results;
      }
    }
  };
}
