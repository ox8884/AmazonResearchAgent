import type { Json } from '@ara/db';
import type { QueueDatabaseClient } from '@ara/queue';
import type { ApiBudget } from '@ara/api-budget';
import { authorizeApiCall } from '@ara/api-budget';
import { JungleScoutClientError } from '@ara/jungle-scout';
import type { ApiCallPurpose, JungleScoutEndpoint } from '@ara/shared';
import { nextBudgetResetAt } from './budget-reset';

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
  if (!staged || typeof staged !== 'object' || !('payload' in staged)) {
    return null;
  }
  const httpAttempts =
    'httpAttempts' in staged && typeof staged.httpAttempts === 'number' ? staged.httpAttempts : 0;
  const status = 'status' in staged && typeof staged.status === 'number' ? staged.status : 200;
  return {
    payload: staged.payload,
    httpAttempts,
    status
  };
}

async function persistUsage(input: {
  readonly client: QueueDatabaseClient;
  readonly budget: ApiBudget;
  readonly candidateId: string;
  readonly endpoint: JungleScoutEndpoint;
  readonly cacheKey: string;
  readonly purpose: ApiCallPurpose;
  readonly httpStatus: number;
  readonly callCount: number;
  readonly cached: boolean;
  readonly success: boolean;
}): Promise<void> {
  const retryCount = Math.max(0, input.callCount - 1);
  const budgetDate = new Date().toISOString().slice(0, 10);
  if (input.budget.complete) {
    const { data, error } = await input.client.rpc('record_api_usage_for_claim', {
      request_cache_key: input.cacheKey,
      claim_owner: input.budget.claimOwner ?? 'worker',
      usage_endpoint: input.endpoint,
      usage_purpose: input.purpose,
      usage_http_status: input.httpStatus,
      usage_call_count: input.callCount,
      usage_retry_count: retryCount,
      usage_cached: input.cached,
      usage_success: input.success,
      usage_candidate_id: input.candidateId,
      usage_budget_date: budgetDate
    });
    if (error) {
      throw new Error(`Could not persist API usage: ${error.message}`);
    }
    if (data !== true) {
      throw new Error(`Could not persist API usage for ${input.cacheKey}`);
    }
    return;
  }
  const { error } = await input.client.from('api_usage').insert({
    endpoint: input.endpoint,
    cache_key: input.cacheKey,
    purpose: input.purpose,
    http_status: input.httpStatus,
    call_count: input.callCount,
    retry_count: retryCount,
    cached: input.cached,
    success: input.success,
    candidate_id: input.candidateId,
    budget_date: budgetDate
  });
  if (error) {
    throw new Error(`Could not persist API usage: ${error.message}`);
  }
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
        let skippedHttp = false;
        if (recovered) {
          fetched = recovered;
          skippedHttp = true;
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
        await persistUsage({
          client: input.client,
          budget: input.budget,
          candidateId: input.candidateId,
          endpoint: input.endpoint,
          cacheKey: input.cacheKey,
          purpose: input.purpose,
          httpStatus: fetched.status,
          callCount: fetched.httpAttempts,
          cached: false,
          success: true
        });
        await input.budget.complete?.(input.cacheKey);
        return {
          kind: 'completed',
          httpAttempts: fetched.httpAttempts,
          status: fetched.status,
          fromCache: skippedHttp,
          payload: fetched.payload
        };
      } catch (error: unknown) {
        if (error instanceof JungleScoutClientError) {
          await persistUsage({
            client: input.client,
            budget: input.budget,
            candidateId: input.candidateId,
            endpoint: input.endpoint,
            cacheKey: input.cacheKey,
            purpose: input.purpose,
            httpStatus: error.status ?? 0,
            callCount: error.httpAttempts,
            cached: false,
            success: false
          });
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
