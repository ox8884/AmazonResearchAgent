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

export class PostgresApiBudget implements ApiBudget {
  constructor(
    private readonly client: QueueDatabaseClient,
    private readonly limits: {
      readonly dailyLimit: number;
      readonly reservedLimit: number;
    }
  ) {}

  async authorize(input: AuthorizeApiCallInput): Promise<ApiAuthorizationDecision> {
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
    return mapDecision(row);
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
