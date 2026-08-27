import { randomUUID } from 'node:crypto';
import { createServerDatabaseClient } from '@ara/db';
import {
  type AiProvider,
  type AiProviderResult,
  type ProviderHealth,
  type StructuredAiRequest
} from '@ara/ai-router';
import {
  AiUsageSchema,
  type AiModelDescriptor
} from '@ara/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  runNormalizeJob,
  type NormalizeJobInput
} from './normalize-opportunities';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const integration = supabaseUrl && serviceRoleKey ? describe : describe.skip;

const healthy: ProviderHealth = {
  available: true,
  checkedAt: new Date(0).toISOString(),
  reason: null,
  retryAfterSeconds: null
};

class FakeNormalizationProvider implements AiProvider {
  readonly id = `fake-normalizer-${randomUUID()}`;
  readonly billingType = 'free' as const;
  calls = 0;

  async health(): Promise<ProviderHealth> {
    return healthy;
  }

  async listModels(): Promise<readonly AiModelDescriptor[]> {
    return [];
  }

  async runStructured<T>(
    request: StructuredAiRequest<T>
  ): Promise<AiProviderResult<T>> {
    this.calls += 1;
    const output = request.prompt.toLocaleLowerCase('en-US').includes('pikachu')
      ? {
          classification: 'brand_ip',
          canonicalNiche: null,
          canonicalEnglish: null,
          catalogPhrases: [],
          aliases: ['pikachu lunch box'],
          productFit: 'poor',
          riskFlags: ['ip'],
          confidence: 0.99,
          reason: 'The phrase contains a known franchise term.'
        }
      : {
          classification: 'product_niche',
          canonicalNiche: 'Batter / Pancake Dispenser',
          canonicalEnglish: 'Batter / Pancake Dispenser',
          catalogPhrases: ['pancake dispenser', 'batter dispenser bottle'],
          aliases: ['pancake dispenser bottle'],
          productFit: 'strong',
          riskFlags: [],
          confidence: 0.94,
          reason: 'Equivalent product phrases describe one dispensing niche.'
        };
    return {
      output: request.schema.parse(output),
      providerId: this.id,
      modelId: request.modelId,
      role: request.role,
      inputHash: request.inputHash,
      usage: AiUsageSchema.parse({
        inputTokens: 20,
        outputTokens: 30,
        totalTokens: 50,
        requestCount: 1
      }),
      costClass: this.billingType,
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(1).toISOString()
    };
  }
}

class CapacityProvider extends FakeNormalizationProvider {
  override async runStructured<T>(
    request: StructuredAiRequest<T>
  ): Promise<AiProviderResult<T>> {
    void request;
    throw Object.assign(new Error('provider unavailable'), { retryable: true });
  }
}

function databaseClient() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase integration environment is required.');
  }
  return createServerDatabaseClient({ url: supabaseUrl, serviceRoleKey });
}

async function seedCandidates(
  client: ReturnType<typeof databaseClient>,
  keywords: readonly string[]
): Promise<{ importRunId: string; candidateIds: string[] }> {
  const importRunId = randomUUID();
  const { error: importError } = await client.from('import_runs').insert({
    id: importRunId,
    submission_hash: `normalize-it-${importRunId}`,
    file_count: 1,
    total_row_count: keywords.length,
    unique_keyword_count: keywords.length,
    source_files: []
  });
  if (importError) {
    throw importError;
  }

  const candidateIds: string[] = [];
  for (const [index, keyword] of keywords.entries()) {
    const rawId = randomUUID();
    const candidateId = randomUUID();
    candidateIds.push(candidateId);
    const { error: rawError } = await client.from('raw_opportunity_keywords').insert({
      id: rawId,
      import_run_id: importRunId,
      source_file_name: 'normalize-fixture.csv',
      source_hash: `${importRunId}-${index}`,
      source_row_number: index + 1,
      row_hash: `${importRunId}-row-${index}`,
      raw_row_text: keyword,
      raw_row: { Keyword: keyword },
      parsed_row: { keyword },
      keyword,
      normalized_exact_keyword: keyword.toLocaleLowerCase('en-US'),
      is_exact_duplicate: false
    });
    if (rawError) {
      throw rawError;
    }
    const { error: candidateError } = await client.from('candidates').insert({
      id: candidateId,
      import_run_id: importRunId,
      representative_raw_keyword_id: rawId,
      keyword,
      normalized_exact_keyword: keyword.toLocaleLowerCase('en-US'),
      state: 'AI Screening',
      rule_passed: true,
      rule_reasons: [],
      risk_flags: [],
      preliminary_score: 80,
      preliminary_score_components: {},
      eligible_for_ai_normalization: true
    });
    if (candidateError) {
      throw candidateError;
    }
  }
  return { importRunId, candidateIds };
}

integration('opportunity normalization job', () => {
  const client = databaseClient();
  const providers: string[] = [];
  const importRuns: string[] = [];

  afterEach(async () => {
    for (const providerId of providers.splice(0)) {
      await client.from('ai_usage').delete().eq('provider_id', providerId);
      await client.from('ai_analyses').delete().eq('provider_id', providerId);
      await client.from('ai_providers').delete().eq('id', providerId);
    }
    for (const importRunId of importRuns.splice(0)) {
      await client.from('import_runs').delete().eq('id', importRunId);
    }
    const { data: clusters } = await client
      .from('niche_clusters')
      .select('id')
      .eq('canonical_name', 'Batter / Pancake Dispenser');
    const clusterIds = clusters?.map((cluster) => cluster.id) ?? [];
    if (clusterIds.length > 0) {
      await client.from('niche_cluster_keywords').delete().in('niche_cluster_id', clusterIds);
      await client.from('niche_clusters').delete().in('id', clusterIds);
    }
  });

  it('clusters dispenser phrases and reuses one analysis per input hash', async () => {
    const provider = new FakeNormalizationProvider();
    providers.push(provider.id);
    const { error: providerError } = await client.from('ai_providers').insert({
      id: provider.id,
      name: provider.id,
      kind: 'command',
      billing_type: 'free',
      enabled: true,
      config: {}
    });
    if (providerError) {
      throw providerError;
    }
    const fixture = await seedCandidates(client, [
      'pancake dispenser bottle',
      'batter squeeze bottle',
      'batter mixer and dispenser',
      'pikachu lunch box'
    ]);
    importRuns.push(fixture.importRunId);
    const input: NormalizeJobInput = { candidateIds: fixture.candidateIds, locale: 'ko' };

    const first = await runNormalizeJob(input, {
      client,
      provider,
      modelId: 'fake-normalizer-model'
    });
    const second = await runNormalizeJob(input, {
      client,
      provider,
      modelId: 'fake-normalizer-model'
    });

    const { data: clusters } = await client
      .from('niche_clusters')
      .select('id')
      .eq('canonical_name', 'Batter / Pancake Dispenser');
    const { data: links } = await client
      .from('niche_cluster_keywords')
      .select('raw_opportunity_keyword_id')
      .in('niche_cluster_id', clusters?.map((cluster) => cluster.id) ?? []);
    const { data: analyses } = await client
      .from('ai_analyses')
      .select('input_hash')
      .eq('provider_id', provider.id);
    const { data: brand } = await client
      .from('candidates')
      .select('state,niche_cluster_id')
      .eq('id', fixture.candidateIds[3] ?? '')
      .single();

    expect(first.clusteredCount).toBe(3);
    expect(second.reusedAnalysisCount).toBe(4);
    expect(provider.calls).toBe(4);
    expect(clusters).toHaveLength(1);
    expect(links).toHaveLength(3);
    expect(analyses).toHaveLength(4);
    expect(new Set(analyses?.map((analysis) => analysis.input_hash)).size).toBe(4);
    expect(brand).toMatchObject({ state: 'Reject', niche_cluster_id: null });
  });

  it('moves candidates to Waiting for AI Capacity on provider outage', async () => {
    const provider = new CapacityProvider();
    providers.push(provider.id);
    const { error: providerError } = await client.from('ai_providers').insert({
      id: provider.id,
      name: provider.id,
      kind: 'command',
      billing_type: 'subscription',
      enabled: true,
      config: {}
    });
    if (providerError) {
      throw providerError;
    }
    const fixture = await seedCandidates(client, ['batter squeeze bottle']);
    importRuns.push(fixture.importRunId);

    const result = await runNormalizeJob(
      { candidateIds: fixture.candidateIds, locale: 'ko' },
      { client, provider, modelId: 'capacity-model' }
    );
    const { data: candidate } = await client
      .from('candidates')
      .select('state')
      .eq('id', fixture.candidateIds[0] ?? '')
      .single();

    expect(result.deferredCount).toBe(1);
    expect(candidate?.state).toBe('Waiting for AI Capacity');
  });
});
