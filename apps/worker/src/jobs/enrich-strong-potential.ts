import type { QueueDatabaseClient } from '@ara/queue';

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
  void candidate.state;
  return { differentiationMode: 'missing' };
}
