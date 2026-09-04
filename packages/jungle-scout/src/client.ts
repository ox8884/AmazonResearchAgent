import ky, { HTTPError, TimeoutError } from 'ky';

const RETRY_STATUS_CODES = [
  429,
  ...Array.from({ length: 100 }, (_, index) => 500 + index)
];

export interface JungleScoutClientConfig {
  readonly keyName: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly retryLimit?: number;
  readonly log?: (message: string) => void;
}

export interface JungleScoutRequestResult {
  readonly body: unknown;
  readonly status: number;
  readonly httpAttempts: number;
}

export class JungleScoutClientError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  readonly httpAttempts: number;

  constructor(
    message: string,
    status: number | null,
    retryable: boolean,
    httpAttempts: number,
    cause?: unknown
  ) {
    super(message, { cause });
    this.name = 'JungleScoutClientError';
    this.status = status;
    this.retryable = retryable;
    this.httpAttempts = httpAttempts;
  }
}

function redact(value: string, secret: string): string {
  return secret.length === 0 ? value : value.split(secret).join('[REDACTED]');
}

export class JungleScoutClient {
  private readonly http: typeof ky;
  private readonly apiKey: string;
  private readonly log: (message: string) => void;
  private attempts = 0;

  constructor(config: JungleScoutClientConfig) {
    this.apiKey = config.apiKey;
    this.log = config.log ?? (() => undefined);
    this.http = ky.create({
      prefixUrl: config.baseUrl.replace(/\/+$/u, ''),
      timeout: config.timeoutMs ?? 30_000,
      redirect: 'manual',
      retry: {
        limit: config.retryLimit ?? 2,
        methods: ['get', 'post'],
        statusCodes: RETRY_STATUS_CODES
      },
      hooks: {
        beforeRequest: [
          (request) => {
            request.headers.set('authorization', `${config.keyName}:${config.apiKey}`);
            request.headers.set('x-api-type', 'junglescout');
            request.headers.set('accept', 'application/vnd.junglescout.v1+json');
            request.headers.set('content-type', 'application/vnd.api+json');
            this.log(`${request.method} ${request.url}`);
          }
        ],
        beforeRetry: [
          () => {
            this.attempts += 1;
          }
        ]
      }
    });
  }

  async request(
    path: string,
    options: { readonly method: 'GET' | 'POST'; readonly json?: unknown }
  ): Promise<JungleScoutRequestResult> {
    this.attempts = 1;
    try {
      const response = await this.http(path.replace(/^\//u, ''), {
        method: options.method.toLowerCase() as 'get' | 'post',
        ...(options.json ? { json: options.json } : {})
      });
      const body: unknown = await response.json();
      return {
        body,
        status: response.status,
        httpAttempts: this.attempts
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private mapError(error: unknown): JungleScoutClientError {
    if (error instanceof TimeoutError) {
      return new JungleScoutClientError(
        'Jungle Scout request timed out.',
        null,
        true,
        this.attempts,
        error
      );
    }
    if (error instanceof HTTPError) {
      const status = error.response.status;
      const retryable = RETRY_STATUS_CODES.includes(status);
      return new JungleScoutClientError(
        redact(`Jungle Scout request failed with status ${status}.`, this.apiKey),
        status,
        retryable,
        this.attempts,
        error
      );
    }
    const message = error instanceof Error ? error.message : 'Jungle Scout request failed.';
    return new JungleScoutClientError(
      redact(message, this.apiKey),
      null,
      false,
      this.attempts,
      error
    );
  }
}
