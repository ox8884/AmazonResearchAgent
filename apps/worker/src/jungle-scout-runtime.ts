import {
  JungleScoutClient,
  queryHistoricalSearchVolume,
  queryKeywordMetrics,
  queryProductDatabase,
  querySalesEstimates,
  queryShareOfVoice,
  type HistoricalSearchVolumeQueryResult,
  type KeywordMetrics,
  type ProductDatabaseQueryResult,
  type SalesEstimatesQueryResult,
  type ShareOfVoiceQueryResult
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
): (phrases: readonly string[]) => Promise<ProductDatabaseQueryResult> {

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

export function createJungleScoutKeywordQuery(

  env: NodeJS.ProcessEnv = process.env
): (keyword: string) => Promise<KeywordMetrics> {
  let client: JungleScoutClient | undefined;
  return async (keyword) => {
    if (!client) {
      const config = readJungleScoutEnv(env);
      client = new JungleScoutClient({
        keyName: config.keyName,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl
      });
    }
    return queryKeywordMetrics(client, {
      marketplace: 'us',
      keyword
    });
  };
}

export function createJungleScoutHistoricalSearchVolumeQuery(
  env: NodeJS.ProcessEnv = process.env
): (keyword: string) => Promise<HistoricalSearchVolumeQueryResult> {
  let client: JungleScoutClient | undefined;
  return async (keyword) => {
    if (!client) {
      const config = readJungleScoutEnv(env);
      client = new JungleScoutClient({
        keyName: config.keyName,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl
      });
    }
    return queryHistoricalSearchVolume(client, { marketplace: 'us', keyword });
  };
}

export function createJungleScoutSalesEstimatesQuery(
  env: NodeJS.ProcessEnv = process.env
): (asins: readonly string[]) => Promise<SalesEstimatesQueryResult> {
  let client: JungleScoutClient | undefined;
  return async (asins) => {
    if (!client) {
      const config = readJungleScoutEnv(env);
      client = new JungleScoutClient({
        keyName: config.keyName,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl
      });
    }
    return querySalesEstimates(client, { marketplace: 'us', asins: [...asins] });
  };
}

export function createJungleScoutShareOfVoiceQuery(
  env: NodeJS.ProcessEnv = process.env
): (keyword: string) => Promise<ShareOfVoiceQueryResult> {
  let client: JungleScoutClient | undefined;
  return async (keyword) => {
    if (!client) {
      const config = readJungleScoutEnv(env);
      client = new JungleScoutClient({
        keyName: config.keyName,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl
      });
    }
    return queryShareOfVoice(client, { marketplace: 'us', keyword });
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
