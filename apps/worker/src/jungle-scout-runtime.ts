import {
  JungleScoutClient,
  queryProductDatabase,
  type ProductDatabasePage
} from '@ara/jungle-scout';

const DEFAULT_BASE_URL = 'https://developer.junglescout.com';
const DEFAULT_DAILY_LIMIT = 20;
const DEFAULT_RESERVED_LIMIT = 5;

export class JungleScoutConfigurationError extends Error {
  constructor() {
    super('Jungle Scout is not configured');
    this.name = 'JungleScoutConfigurationError';
  }
}

export function readJungleScoutEnv(env: NodeJS.ProcessEnv = process.env): {
  readonly keyName: string;
  readonly apiKey: string;
  readonly baseUrl: string;
} {
  const keyName = env.JUNGLE_SCOUT_KEY_NAME?.trim();
  const apiKey = env.JUNGLE_SCOUT_API_KEY?.trim();
  if (!keyName || !apiKey) {
    throw new JungleScoutConfigurationError();
  }
  const baseUrl = env.JUNGLE_SCOUT_BASE_URL?.trim();
  return {
    keyName,
    apiKey,
    baseUrl: baseUrl && baseUrl.length > 0 ? baseUrl : DEFAULT_BASE_URL
  };
}

export function readApiBudgetLimits(env: NodeJS.ProcessEnv = process.env): {
  readonly dailyLimit: number;
  readonly reservedLimit: number;
} {
  return {
    dailyLimit: parseLimit(env.JUNGLE_SCOUT_DAILY_LIMIT, DEFAULT_DAILY_LIMIT),
    reservedLimit: parseLimit(
      env.JUNGLE_SCOUT_RESERVED_LIMIT,
      DEFAULT_RESERVED_LIMIT
    )
  };
}

export function createJungleScoutProductDatabaseQuery(
  env: NodeJS.ProcessEnv = process.env
): (phrases: readonly string[]) => Promise<ProductDatabasePage> {
  let client: JungleScoutClient | undefined;
  return async (phrases) => {
    if (!client) {
      const config = readJungleScoutEnv(env);
      client = new JungleScoutClient({
        keyName: config.keyName,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl
      });
    }
    return queryProductDatabase(client, {
      marketplace: 'us',
      phrases: [...phrases]
    });
  };
}

function parseLimit(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}
