import type { ApiCallPurpose, JungleScoutEndpoint } from '@ara/shared';

export const DEFAULT_CACHE_TTL_MS = {
  product_database: 24 * 60 * 60 * 1000,
  keywords_by_keyword: 7 * 24 * 60 * 60 * 1000,
  historical_search_volume: 14 * 24 * 60 * 60 * 1000,
  sales_estimates: 24 * 60 * 60 * 1000,
  share_of_voice: 24 * 60 * 60 * 1000
} as const satisfies Record<JungleScoutEndpoint, number>;

export type ApiAuthorizationDecision =
  | { readonly kind: 'cache_hit'; readonly cacheKey: string }
  | { readonly kind: 'allowed'; readonly cacheKey: string; readonly remaining: number }
  | { readonly kind: 'deferred_budget'; readonly cacheKey: string }
  | { readonly kind: 'blocked_policy'; readonly cacheKey: string; readonly reason: string };

export interface AuthorizeApiCallInput {
  readonly purpose: ApiCallPurpose;
  readonly estimatedCalls: number;
  readonly cacheKey: string;
  readonly endpoint: JungleScoutEndpoint;
  readonly now?: Date;
}

export interface ApiBudget {
  authorize(input: AuthorizeApiCallInput): Promise<ApiAuthorizationDecision>;
}

export interface ApiBudgetStore extends ApiBudget {
  hasFreshCache(cacheKey: string, endpoint: JungleScoutEndpoint, now: Date): boolean;
  reserve(input: AuthorizeApiCallInput, now: Date): ApiAuthorizationDecision;
}

export class MemoryApiBudget implements ApiBudgetStore {
  used: number;
  private readonly dailyLimit: number;
  private readonly reservedLimit: number;
  private readonly cache = new Map<string, number>();
  private chain: Promise<void> = Promise.resolve();

  constructor(seed: { dailyLimit: number; used: number; reserve: number }) {
    this.dailyLimit = seed.dailyLimit;
    this.used = seed.used;
    this.reservedLimit = seed.reserve;
  }

  seedCache(cacheKey: string, input: { capturedAt: Date; ttlMs: number }): void {
    this.cache.set(cacheKey, input.capturedAt.getTime() + input.ttlMs);
  }

  hasFreshCache(cacheKey: string, _endpoint: JungleScoutEndpoint, now: Date): boolean {
    const expiresAt = this.cache.get(cacheKey);
    return expiresAt !== undefined && expiresAt > now.getTime();
  }

  reserve(input: AuthorizeApiCallInput, now: Date): ApiAuthorizationDecision {
    if (this.hasFreshCache(input.cacheKey, input.endpoint, now)) {
      return { kind: 'cache_hit', cacheKey: input.cacheKey };
    }
    if (input.estimatedCalls < 1) {
      return {
        kind: 'blocked_policy',
        cacheKey: input.cacheKey,
        reason: 'estimatedCalls must be at least 1'
      };
    }
    const ceiling =
      input.purpose === 'normal_validation'
        ? this.dailyLimit - this.reservedLimit
        : this.dailyLimit;
    if (this.used + input.estimatedCalls > ceiling) {
      return { kind: 'deferred_budget', cacheKey: input.cacheKey };
    }
    this.used += input.estimatedCalls;
    return {
      kind: 'allowed',
      cacheKey: input.cacheKey,
      remaining: this.dailyLimit - this.used
    };
  }

  async authorize(input: AuthorizeApiCallInput): Promise<ApiAuthorizationDecision> {
    const now = input.now ?? new Date();
    return this.serialize(() => this.reserve(input, now));
  }

  async serialize<T>(work: () => T | Promise<T>): Promise<T> {
    const run = this.chain.then(work, work);
    this.chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

export async function authorizeApiCall(
  store: ApiBudget,
  input: AuthorizeApiCallInput
): Promise<ApiAuthorizationDecision> {
  return store.authorize(input);
}
