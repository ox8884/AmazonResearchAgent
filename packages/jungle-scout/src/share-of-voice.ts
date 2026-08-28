import { z } from 'zod';
import type { JungleScoutClient } from './client';

export const ShareOfVoiceInputSchema = z.object({
  marketplace: z.literal('us'),
  keyword: z.string().trim().min(1)
});
export type ShareOfVoiceInput = z.infer<typeof ShareOfVoiceInputSchema>;

const ShareOfVoiceRowSchema = z.object({
  asin: z.string(),
  share: z.number().nullable()
});

export const ShareOfVoiceSchema = z.object({
  keyword: z.string(),
  rows: z.array(ShareOfVoiceRowSchema)
});
export type ShareOfVoice = z.infer<typeof ShareOfVoiceSchema>;

export interface ShareOfVoiceQueryResult {
  readonly data: ShareOfVoice;
  readonly httpAttempts: number;
  readonly status: number;
}

export function buildShareOfVoiceRequest(input: ShareOfVoiceInput): {
  readonly path: string;
  readonly method: 'GET';
} {
  const parsed = ShareOfVoiceInputSchema.parse(input);
  const params = new URLSearchParams({
    marketplace: parsed.marketplace,
    keyword: parsed.keyword
  });
  return {
    path: `/api/share_of_voice?${params.toString()}`,
    method: 'GET'
  };
}

export async function queryShareOfVoice(
  client: JungleScoutClient,
  input: ShareOfVoiceInput
): Promise<ShareOfVoiceQueryResult> {
  const request = buildShareOfVoiceRequest(input);
  const result = await client.request(request.path, { method: request.method });
  const body = result.body;
  const rows: Array<{ asin: string; share: number | null }> = [];
  if (typeof body === 'object' && body !== null && 'data' in body && Array.isArray(body.data)) {
    for (const row of body.data) {
      if (typeof row !== 'object' || row === null) {
        continue;
      }
      const record = row as { id?: unknown; attributes?: Record<string, unknown> };
      const asin = typeof record.id === 'string' ? record.id : null;
      const share = typeof record.attributes?.share === 'number' ? record.attributes.share : null;
      if (asin) {
        rows.push({ asin, share });
      }
    }
  }
  return {
    data: ShareOfVoiceSchema.parse({ keyword: input.keyword, rows }),
    httpAttempts: result.httpAttempts,
    status: result.status
  };
}
