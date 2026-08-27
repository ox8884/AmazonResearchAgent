export class AbuseGuardError extends Error {
  readonly status = 429;

  constructor(message = 'Too many requests.') {
    super(message);
    this.name = 'AbuseGuardError';
  }
}

export interface TokenBucket {
  consume(key: string, now?: number): void;
  reset(): void;
}

export function createTokenBucket(options: {
  readonly max: number;
  readonly windowMs: number;
}): TokenBucket {
  const hits = new Map<string, number[]>();
  return {
    consume(key, now = Date.now()) {
      const windowStart = now - options.windowMs;
      const recent = (hits.get(key) ?? []).filter((stamp) => stamp > windowStart);
      if (recent.length >= options.max) {
        hits.set(key, recent);
        throw new AbuseGuardError();
      }
      recent.push(now);
      hits.set(key, recent);
    },
    reset() {
      hits.clear();
    }
  };
}

export interface ConcurrencyGate {
  run<T>(key: string, work: () => Promise<T>): Promise<T>;
  reset(): void;
}

export function createConcurrencyGate(max: number): ConcurrencyGate {
  const inflight = new Map<string, number>();
  return {
    async run(key, work) {
      const current = inflight.get(key) ?? 0;
      if (current >= max) {
        throw new AbuseGuardError('Too many concurrent requests.');
      }
      inflight.set(key, current + 1);
      try {
        return await work();
      } finally {
        const next = (inflight.get(key) ?? 1) - 1;
        if (next <= 0) {
          inflight.delete(key);
        } else {
          inflight.set(key, next);
        }
      }
    },
    reset() {
      inflight.clear();
    }
  };
}

/**
 * Login identity for rate limiting.
 *
 * Vercel/proxy `x-forwarded-for` is attacker-controlled unless the deployment
 * terminates TLS at a trusted hop that overwrites the header. This MVP does
 * not treat that header as identity. A single-admin process uses one global
 * login bucket plus a concurrent scrypt cap.
 */
export const LOGIN_RATE_KEY = 'admin-login';
export const loginRateLimit = createTokenBucket({ max: 8, windowMs: 5 * 60_000 });
export const loginScryptGate = createConcurrencyGate(1);

export const importRateLimit = createTokenBucket({ max: 10, windowMs: 60_000 });
export const importConcurrencyGate = createConcurrencyGate(1);
