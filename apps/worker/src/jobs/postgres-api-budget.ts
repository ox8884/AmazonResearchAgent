import type { Json } from '@ara/db';
import type { QueueDatabaseClient } from '@ara/queue';
import type {
  ApiAuthorizationDecision,
  ApiBudget,
  AuthorizeApiCallInput
} from '@ara/api-budget';

const CLAIM_LEASE_SECONDS = 120;

type AuthorizationRow = {
  decision_kind: string;
  cache_key: string;
  remaining: number | null;
};

type ClaimRow = {
  decision_kind: string;
  claimed_cache_key: string;
};

export class ApiCallOwnershipError extends Error {
  constructor(cacheKey: string) {
    super(`API call ownership was lost for ${cacheKey}.`);
    this.name = 'ApiCallOwnershipError';
  }
}

export class PostgresApiBudget implements ApiBudget {
  readonly claimOwner: string;

  constructor(
    private readonly client: QueueDatabaseClient,
    private readonly limits: {
      readonly dailyLimit: number;
      readonly reservedLimit: number;
    },
    owner = 'worker'
  ) {
    this.claimOwner = owner;
  }

  async authorize(input: AuthorizeApiCallInput): Promise<ApiAuthorizationDecision> {
    const { data: claimData, error: claimError } = await this.client.rpc('claim_api_call', {
      request_cache_key: input.cacheKey,
      claim_owner: this.claimOwner,
      lease_seconds: CLAIM_LEASE_SECONDS
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

    const { data, error } = await this.client.rpc('authorize_owned_api_call', {
      request_cache_key: input.cacheKey,
      claim_owner: this.claimOwner,
      purpose: input.purpose,
      estimated_calls: input.estimatedCalls,
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
    return mapDecision(row as AuthorizationRow);
  }

  async complete(cacheKey: string): Promise<void> {
    const { data, error } = await this.client.rpc('complete_api_call_claim', {
      request_cache_key: cacheKey,
      claim_owner: this.claimOwner
    });
    if (error) {
      throw new Error(`Could not complete API call claim: ${error.message}`);
    }
    if (data !== true) {
      throw new ApiCallOwnershipError(cacheKey);
    }
  }

  async stage(cacheKey: string, response: unknown): Promise<void> {
    const { data, error } = await this.client.rpc('stage_api_call_response', {
      request_cache_key: cacheKey,
      claim_owner: this.claimOwner,
      response: asJson(response)
    });
    if (error) {
      throw new Error(`Could not stage API call response: ${error.message}`);
    }
    if (data !== true) {
      throw new ApiCallOwnershipError(cacheKey);
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
