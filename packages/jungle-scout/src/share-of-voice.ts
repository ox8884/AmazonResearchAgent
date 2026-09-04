import { z } from 'zod';
import type { JungleScoutClient } from './client';

export const ShareOfVoiceInputSchema = z.object({
  marketplace: z.literal('us'),
  keyword: z.string().trim().min(1)
});
export type ShareOfVoiceInput = z.infer<typeof ShareOfVoiceInputSchema>;

const ShareOfVoiceBrandSchema = z.object({
  brand: z.string(),
  share: z.number().nullable()
});

export const ShareOfVoiceSchema = z.object({
  keyword: z.string(),
  brands: z.array(ShareOfVoiceBrandSchema)
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
  const brands: Array<{ brand: string; share: number | null }> = [];
  if (typeof body === 'object' && body !== null && 'data' in body) {
    const data = body.data;
    const attributes =
      data && typeof data === 'object' && 'attributes' in data && data.attributes
        && typeof data.attributes === 'object'
        ? data.attributes
        : {};
    const providerBrands = 'brands' in attributes && Array.isArray(attributes.brands)
      ? attributes.brands
      : [];
    for (const item of providerBrands) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const record = item as Record<string, unknown>;
      const brand = typeof record.brand === 'string' ? record.brand : null;
      const share =
        typeof record.combined_weighted_sov === 'number'
          ? record.combined_weighted_sov
          : null;
      if (brand) {
        brands.push({ brand, share });
      }
    }
  }
  return {
    data: ShareOfVoiceSchema.parse({ keyword: input.keyword, brands }),
    httpAttempts: result.httpAttempts,
    status: result.status
  };
}
