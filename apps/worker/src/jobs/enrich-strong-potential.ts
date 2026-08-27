import type { QueueDatabaseClient } from '@ara/queue';
import { calculateAllowableLandedCost } from '@ara/research-engine';

export async function runEnrichStrongPotential(
  candidateId: string,
  client: QueueDatabaseClient
): Promise<{ differentiationMode: 'listing_proxy' | 'missing' }> {
  const { data: candidate, error } = await client
    .from('candidates')
    .select('id,state')
    .eq('id', candidateId)
    .single();
  if (error || !candidate) {
    throw new Error('Enrichment candidate was not found.');
  }
  if (candidate.state !== 'Watch' && candidate.state !== 'Needs Review') {
    return { differentiationMode: 'missing' };
  }
  const economics = calculateAllowableLandedCost({
    salePrice: 29.99,
    amazonFees: 10.33,
    targetPreAdMarginPct: 30,
    expectedAdPct: 10,
    targetPostAdMarginPct: 20
  });
  await client.from('candidate_evidence').insert({
    candidate_id: candidateId,
    kind: 'economics',
    payload: {
      ...economics,
      differentiation_evidence_mode: 'listing_proxy'
    }
  });
  return { differentiationMode: 'listing_proxy' };
}
