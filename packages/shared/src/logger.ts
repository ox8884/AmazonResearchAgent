const SECRET_KEY = /key|token|authorization|cookie|secret|password|ciphertext/iu;
const TELEGRAM_BOT_PATH = /\/bot\d+:[A-Za-z0-9_-]+\//gu;
const TELEGRAM_BOT_URL = /https?:\/\/[^\s"]*\/bot\d+:[A-Za-z0-9_-]+\/[^\s"]*/giu;

export type StructuredLog = {
  readonly timestamp: string;
  readonly level: 'info' | 'error';
  readonly service: string;
  readonly event: string;
  readonly jobId?: string;
  readonly researchRunId?: string;
  readonly candidateId?: string;
  readonly durationMs?: number;
  readonly errorCode?: string;
  readonly [key: string]: unknown;
};

function redactString(value: string): string {
  return value
    .replace(TELEGRAM_BOT_URL, '[REDACTED_URL]')
    .replace(TELEGRAM_BOT_PATH, '/bot[REDACTED]/');
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry));
  }
  if (value && typeof value === 'object') {
    const redacted: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      redacted[key] = SECRET_KEY.test(key) ? '[REDACTED]' : redactValue(nested);
    }
    return redacted;
  }
  return value;
}

export function formatLog(input: Record<string, unknown>): string {
  const redacted = redactValue(input) as Record<string, unknown>;
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'ara',
    event: 'log',
    ...redacted
  });
}
