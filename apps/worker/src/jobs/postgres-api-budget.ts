import type { Json } from '@ara/db';
import type { QueueDatabaseClient } from '@ara/queue';
import type {
  ApiAuthorizationDecision,
  ApiBudget,
  AuthorizeApiCallInput
} from '@ara/api-budget';


type AuthorizationRow = {
  decision_kind: string;
  cache_key: string;
  remaining: number | null;
};

type ClaimRow = {
  decision_kind: string;
  claimed_cache_key: string;
};

type ClaimState = {
  reserved: boolean | null;
  budget_date: string | null;
};

export class PostgresApiBudget implements ApiBudget {
  constructor(
    private readonly client: QueueDatabaseClient,
    private readonly limits: {
      readonly dailyLimit: number;
      readonly reservedLimit: number;
    },
    private readonly owner = 'worker'
  ) {}

  async authorize(input: AuthorizeApiCallInput): Promise<ApiAuthorizationDecision> {
    const { data: claimData, error: claimError } = await this.client.rpc('claim_api_call', {
      request_cache_key: input.cacheKey,
      claim_owner: this.owner,
      lease_seconds: 60
    });
    if (claimError) {
      throw new Error(`Could not claim API call: ${claimError.message}`);
    }
    const claim = (Array.isArray(claimData) ? claimData[0] : claimData) as ClaimRow | null;
    if (!claim) {
      throw new Error('Could not claim API call: empty decision');
    }
    if (claim.decision_kind === 'cache_hit') {
      return { kind: 'cache_hit', cacheKey: claim.claimed_cache_key };
    }
    if (claim.decision_kind === 'in_flight') {
      return { kind: 'in_flight', cacheKey: claim.claimed_cache_key };
    }
    if (claim.decision_kind === 'blocked_policy') {
      return {
        kind: 'blocked_policy',
        cacheKey: claim.claimed_cache_key,
        reason: 'API call was blocked by budget policy'
      };
    }

    const { data: claimState, error: stateError } = await this.client
      .from('api_call_claims')
      .select('reserved,budget_date')
      .eq('cache_key', input.cacheKey)
      .maybeSingle();
    if (stateError) {
      throw new Error(`Could not read API call claim: ${stateError.message}`);
    }
    const state = claimState as ClaimState | null;
    if (state?.reserved) {
      return {
        kind: 'allowed',
        cacheKey: input.cacheKey,
        remaining: this.limits.dailyLimit
      };
    }

    const { data, error } = await this.client.rpc('authorize_api_call', {
      purpose: input.purpose,
      estimated_calls: input.estimatedCalls,
      request_cache_key: input.cacheKey,
      endpoint: input.endpoint,
      daily_limit: this.limits.dailyLimit,
      reserved_limit: this.limits.reservedLimit
    });
    if (error) {
      throw new Error(`Could not authorize API call: ${error.message}`);
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      throw new Error('Could not authorize API call: empty decision');
    }
    const decision = mapDecision(row as AuthorizationRow);
    if (decision.kind === 'allowed') {
      const { error: reservedError } = await this.client.rpc('mark_api_call_reserved', {
        request_cache_key: input.cacheKey,
        request_budget_date: new Date().toISOString().slice(0, 10)
      });
      if (reservedError) {
        throw new Error(`Could not mark API call reserved: ${reservedError.message}`);
      }
    }
    return decision;
  }

  async complete(cacheKey: string): Promise<void> {
    const { error } = await this.client.rpc('complete_api_call_claim', {
      request_cache_key: cacheKey,
      claim_owner: this.owner
    });
    if (error) {
      throw new Error(`Could not complete API call claim: ${error.message}`);
    }
  }

  async stage(cacheKey: string, response: unknown): Promise<void> {
    const { error } = await this.client.rpc('stage_api_call_response', {
      request_cache_key: cacheKey,
      claim_owner: this.owner,
      response: asJson(response)
    });
    if (error) {
      throw new Error(`Could not stage API call response: ${error.message}`);
    }
  }

  async readStaged(cacheKey: string): Promise<unknown | null> {
    const { data, error } = await this.client
      .from('api_call_claims')
      .select('staged_response')
      .eq('cache_key', cacheKey)
      .maybeSingle();
    if (error) {
      throw new Error(`Could not read staged API call response: ${error.message}`);
    }
    if (!data || !('staged_response' in data)) {
      return null;
    }
    return data.staged_response;
  }
}

function mapDecision(row: AuthorizationRow): ApiAuthorizationDecision {
  switch (row.decision_kind) {
    case 'cache_hit':
      return { kind: 'cache_hit', cacheKey: row.cache_key };
    case 'authorized':
      return {
        kind: 'allowed',
        cacheKey: row.cache_key,
        remaining: row.remaining ?? 0
      };
    case 'budget_exhausted':
      return { kind: 'deferred_budget', cacheKey: row.cache_key };
    case 'blocked_policy':
      return {
        kind: 'blocked_policy',
        cacheKey: row.cache_key,
        reason: 'API call was blocked by budget policy'
      };
    default:
      throw new Error(`Unknown API budget decision: ${row.decision_kind}`);
  }
}

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

