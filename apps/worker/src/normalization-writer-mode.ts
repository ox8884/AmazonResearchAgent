import type { QueueDatabaseClient } from '@ara/queue';

export const NORMALIZATION_WRITER_MODE = 'canonical' as const;
export const NORMALIZATION_WRITER_RELEASE_SHA = process.env.NORMALIZATION_WRITER_RELEASE_SHA;

const RELEASE_SHA = /^[0-9a-f]{40}$/u;

type WriterCapabilityClient = Pick<QueueDatabaseClient, 'rpc'>;

export class NormalizationWriterCapabilityError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'NormalizationWriterCapabilityError';
  }
}

export async function assertNormalizationWriterCapability(
  client: WriterCapabilityClient
): Promise<void> {
  const { data, error } = await client.rpc('read_normalization_writer_capability');
  if (error || data !== NORMALIZATION_WRITER_MODE) {
    throw new NormalizationWriterCapabilityError(
      `Database writer capability must be exactly ${NORMALIZATION_WRITER_MODE}.`,
      error ?? undefined
    );
  }
}

export function normalizationWriterIdentity(releaseSha: string | undefined = NORMALIZATION_WRITER_RELEASE_SHA): {
  readonly mode: typeof NORMALIZATION_WRITER_MODE;
  readonly releaseSha: string;
} {
  if (releaseSha === undefined || !RELEASE_SHA.test(releaseSha)) {
    throw new NormalizationWriterCapabilityError(
      'NORMALIZATION_WRITER_RELEASE_SHA must be an immutable 40-character release SHA.'
    );
  }
  return { mode: NORMALIZATION_WRITER_MODE, releaseSha };
}
