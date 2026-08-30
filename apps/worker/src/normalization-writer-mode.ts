import type { QueueDatabaseClient } from '@ara/queue';

export const NORMALIZATION_WRITER_MODE = 'canonical' as const;
export const NORMALIZATION_WRITER_MIGRATION_IDENTITY = '202608290022' as const;
export const NORMALIZATION_WRITER_RELEASE_SHA =
  '13b51161a28f3fbef7a193f13c4fe8bb35c0f21f' as const;

type WriterCapabilityClient = Pick<QueueDatabaseClient, 'rpc'>;

export class NormalizationWriterCapabilityError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'NormalizationWriterCapabilityError';
  }
}

export async function assertNormalizationWriterCapability(
  client: WriterCapabilityClient,
  claimedReleaseSha: string | undefined = process.env.NORMALIZATION_WRITER_RELEASE_SHA
): Promise<void> {
  if (claimedReleaseSha === undefined) {
    throw new NormalizationWriterCapabilityError(
      'NORMALIZATION_WRITER_RELEASE_SHA must claim the immutable Phase-B release SHA.'
    );
  }
  normalizationWriterIdentity(claimedReleaseSha);
  const { data, error } = await client.rpc('read_normalization_writer_capability');
  const capability = typeof data === 'object' && data !== null && !Array.isArray(data)
    ? data
    : null;
  if (
    error ||
    capability === null ||
    capability.mode !== NORMALIZATION_WRITER_MODE ||
    capability.migration_identity !== NORMALIZATION_WRITER_MIGRATION_IDENTITY
  ) {
    throw new NormalizationWriterCapabilityError(
      `Database writer capability must be exactly ${NORMALIZATION_WRITER_MODE} ` +
      `at migration ${NORMALIZATION_WRITER_MIGRATION_IDENTITY}.`,
      error ?? undefined
    );
  }
}

export function normalizationWriterIdentity(
  claimedReleaseSha: string = NORMALIZATION_WRITER_RELEASE_SHA
): {
  readonly mode: typeof NORMALIZATION_WRITER_MODE;
  readonly releaseSha: typeof NORMALIZATION_WRITER_RELEASE_SHA;
} {
  if (claimedReleaseSha !== NORMALIZATION_WRITER_RELEASE_SHA) {
    throw new NormalizationWriterCapabilityError(
      'NORMALIZATION_WRITER_RELEASE_SHA must match the immutable Phase-B release SHA.'
    );
  }
  return {
    mode: NORMALIZATION_WRITER_MODE,
    releaseSha: NORMALIZATION_WRITER_RELEASE_SHA
  };
}
