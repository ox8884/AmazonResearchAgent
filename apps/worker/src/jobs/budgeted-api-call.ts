import type { Json } from '@ara/db';
import type { QueueDatabaseClient } from '@ara/queue';
import type { ApiBudget } from '@ara/api-budget';
import { authorizeApiCall } from '@ara/api-budget';
import { JungleScoutClientError } from '@ara/jungle-scout';
import type { ApiCallPurpose, JungleScoutEndpoint } from '@ara/shared';
import { nextBudgetResetAt } from './market-probe';

export type BudgetedCallOutcome =
  | { readonly kind: 'blocked_policy' }
  | { readonly kind: 'deferred_budget'; readonly availableAt: string }
  | { readonly kind: 'in_flight'; readonly availableAt: string }
  | {
      readonly kind: 'completed';
      readonly httpAttempts: number;
      readonly status: number;
      readonly fromCache: boolean;
      readonly payload: unknown;
    };

export interface BudgetedProviderResult {
  readonly payload: unknown;
  readonly httpAttempts: number;
  readonly status: number;
}

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function parseStaged(staged: unknown): BudgetedProviderResult | null {
  if (!staged || typeof staged !== 'object') {
    return null;
  }
  if (!('payload' in staged)) {
    return null;
  }
  const record = staged as {
    payload?: unknown;
    httpAttempts?: unknown;
    status?: unknown;
  };
  return {
    payload: record.payload,
    httpAttempts: typeof record.httpAttempts === 'number' ? record.httpAttempts : 0,
    status: typeof record.status === 'number' ? record.status : 200
  };
}

export async function executeBudgetedApiCall(input: {
  readonly client: QueueDatabaseClient;
  readonly budget: ApiBudget;
  readonly candidateId: string;
  readonly endpoint: JungleScoutEndpoint;
  readonly cacheKey: string;
  readonly purpose: ApiCallPurpose;
  readonly ttlMs: number;
  readonly query: () => Promise<BudgetedProviderResult>;
}): Promise<BudgetedCallOutcome> {
  const decision = await authorizeApiCall(input.budget, {
    purpose: input.purpose,
    estimatedCalls: 1,
    cacheKey: input.cacheKey,
    endpoint: input.endpoint
  });

  switch (decision.kind) {
    case 'blocked_policy':
      return { kind: 'blocked_policy' };
    case 'deferred_budget':
      return { kind: 'deferred_budget', availableAt: nextBudgetResetAt() };
    case 'in_flight':
      return {
        kind: 'in_flight',
        availableAt: new Date(Date.now() + 15_000).toISOString()
      };
    case 'cache_hit': {
      const { data: cached } = await input.client
        .from('api_cache')
        .select('response')
        .eq('cache_key', input.cacheKey)
        .maybeSingle();
      return {
        kind: 'completed',
        httpAttempts: 0,
        status: 200,
        fromCache: true,
        payload: cached?.response ?? null
      };
    }
    case 'allowed': {
      try {
        const staged = await input.budget.readStaged?.(input.cacheKey);
        const recovered = parseStaged(staged);
        let fetched: BudgetedProviderResult;
        let fromCache = false;
        if (recovered) {
          fetched = recovered;
          fromCache = true;
        } else {
          fetched = await input.query();
          await input.budget.stage?.(input.cacheKey, {
            payload: fetched.payload,
            httpAttempts: fetched.httpAttempts,
            status: fetched.status
          });
        }
        const { error: cacheError } = await input.client.from('api_cache').upsert({
          cache_key: input.cacheKey,
          endpoint: input.endpoint,
          response: asJson(fetched.payload),
          captured_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + input.ttlMs).toISOString()
        });
        if (cacheError) {
          throw new Error(`Could not persist API cache: ${cacheError.message}`);
        }
        const { error: usageError } = await input.client.from('api_usage').insert({
          endpoint: input.endpoint,
          cache_key: input.cacheKey,
          purpose: input.purpose,
          http_status: fetched.status,
          call_count: fetched.httpAttempts,
          retry_count: Math.max(0, fetched.httpAttempts - 1),
          cached: fromCache,
          success: true,
          candidate_id: input.candidateId,
          budget_date: new Date().toISOString().slice(0, 10)
        });
        if (usageError) {
          throw new Error(`Could not persist API usage: ${usageError.message}`);
        }
        await input.budget.complete?.(input.cacheKey);
        return {
          kind: 'completed',
          httpAttempts: fetched.httpAttempts,
          status: fetched.status,
          fromCache,
          payload: fetched.payload
        };
      } catch (error: unknown) {
        if (error instanceof JungleScoutClientError) {
          const { error: usageError } = await input.client.from('api_usage').insert({
            endpoint: input.endpoint,
            cache_key: input.cacheKey,
            purpose: input.purpose,
            http_status: error.status ?? 0,
            call_count: error.httpAttempts,
            retry_count: Math.max(0, error.httpAttempts - 1),
            cached: false,
            success: false,
            candidate_id: input.candidateId,
            budget_date: new Date().toISOString().slice(0, 10)
          });
          if (usageError) {
            throw new Error(`Could not persist API usage: ${usageError.message}`, {
              cause: error
            });
          }
        }
        throw error;
      }
    }
    default: {
      const exhaustive: never = decision;
      throw new Error(`Unhandled authorization decision: ${JSON.stringify(exhaustive)}`);
    }
  }
}
