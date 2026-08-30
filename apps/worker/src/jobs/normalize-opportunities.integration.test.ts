import { randomUUID } from 'node:crypto';
import { createServerDatabaseClient } from '@ara/db';
import {
  InvalidStructuredOutputError,
  type AiProvider,
  type AiProviderResult,
  type ProviderHealth,
  type RawAiProviderResult,
  type StructuredAiRequest
} from '@ara/ai-router';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AiUsageSchema,
  type AiModelDescriptor
} from '@ara/shared';
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
          canonicalNiche: `Batter / Pancake Dispenser ${this.id}`,
          canonicalEnglish: `Batter / Pancake Dispenser ${this.id}`,
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

class NullableEnglishProvider extends FakeNormalizationProvider {
  override async runStructured<T>(
    request: StructuredAiRequest<T>
  ): Promise<AiProviderResult<T>> {
    this.calls += 1;
    return {
      output: request.schema.parse({
        classification: 'product_niche',
        canonicalNiche: `Nullable English ${this.id}`,
        canonicalEnglish: null,
        catalogPhrases: ['nullable english niche'],
        aliases: ['nullable niche'],
        productFit: 'strong',
        riskFlags: [],
        confidence: 0.95,
        reason: 'A valid niche can lack a canonical English translation.'
      }),
      providerId: this.id,
      modelId: request.modelId,
      role: request.role,
      inputHash: request.inputHash,
      usage: AiUsageSchema.parse({
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
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
  return createServerDatabaseClient({
    url: supabaseUrl ?? 'http://127.0.0.1:54321',
    serviceRoleKey: serviceRoleKey ?? 'integration-test-not-configured'
  });
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
      const { data: candidates, error: candidateReadError } = await client
        .from('candidates')
        .select('id')
        .eq('import_run_id', importRunId);
      if (candidateReadError) throw candidateReadError;
      const normalizationKeys = (candidates ?? []).map(
        (candidate) => `normalize:${candidate.id}`
      );
      if (normalizationKeys.length > 0) {
        const { error: jobError } = await client
          .from('jobs')
          .delete()
          .in('idempotency_key', normalizationKeys);
        if (jobError) throw jobError;
      }
      const { error: importRunError } = await client
        .from('import_runs')
        .delete()
        .eq('id', importRunId);
      if (importRunError) throw importRunError;
    }
    const { data: clusters } = await client
      .from('niche_clusters')
      .select('id')
      .like('canonical_name', 'Batter / Pancake Dispenser%');
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
    const promptVersion = `it-${randomUUID()}`;

    const first = await runNormalizeJob(input, {
      client,
      provider,
      modelId: 'fake-normalizer-model',
      promptVersion
    });
    const second = await runNormalizeJob(input, {
      client,
      provider,
      modelId: 'fake-normalizer-model',
      promptVersion
    });

    const { data: clusters } = await client
      .from('niche_clusters')
      .select('id')
      .eq('canonical_name', `Batter / Pancake Dispenser ${provider.id}`);
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
      { client, provider, modelId: 'capacity-model', promptVersion: `it-${randomUUID()}` }
    );
    const { data: candidate } = await client
      .from('candidates')
      .select('state')
      .eq('id', fixture.candidateIds[0] ?? '')
      .single();

    expect(result.deferredCount).toBe(1);
    expect(candidate?.state).toBe('Waiting for AI Capacity');
  });

  it('keeps Korean and English hashes distinct and reuses one call per locale', async () => {
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
    const fixture = await seedCandidates(client, ['batter squeeze bottle']);
    importRuns.push(fixture.importRunId);
    const promptVersion = `it-${randomUUID()}`;
    await runNormalizeJob(
      { candidateIds: fixture.candidateIds, locale: 'ko' },
      { client, provider, modelId: 'fake-normalizer-model', workerId: 'locale-ko', promptVersion }
    );
    await runNormalizeJob(
      { candidateIds: fixture.candidateIds, locale: 'en' },
      { client, provider, modelId: 'fake-normalizer-model', workerId: 'locale-en', promptVersion }
    );

    const { data: analyses } = await client
      .from('ai_analyses')
      .select('input_hash,locale')
      .eq('provider_id', provider.id);

    expect(provider.calls).toBe(2);
    expect(analyses).toHaveLength(2);
    expect(new Set(analyses?.map((analysis) => analysis.input_hash)).size).toBe(2);
    expect(new Set(analyses?.map((analysis) => analysis.locale))).toEqual(new Set(['ko', 'en']));
  });

  it('does not duplicate AI reasons when a completed analysis is reused', async () => {
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
    const fixture = await seedCandidates(client, ['batter squeeze bottle']);
    importRuns.push(fixture.importRunId);
    const promptVersion = `it-${randomUUID()}`;
    const input = { candidateIds: fixture.candidateIds, locale: 'ko' as const };
    await runNormalizeJob(input, {
      client,
      provider,
      modelId: 'fake-normalizer-model',
      promptVersion
    });
    const { data: first } = await client
      .from('candidates')
      .select('state,rule_reasons')
      .eq('id', fixture.candidateIds[0] ?? '')
      .single();
    await runNormalizeJob(input, {
      client,
      provider,
      modelId: 'fake-normalizer-model',
      promptVersion
    });
    const { data: second } = await client
      .from('candidates')
      .select('state,rule_reasons')
      .eq('id', fixture.candidateIds[0] ?? '')
      .single();
    const { data: decisions } = await client
      .from('decision_history')
      .select('id')
      .eq('candidate_id', fixture.candidateIds[0] ?? '');
    const codes = Array.isArray(second?.rule_reasons)
      ? second.rule_reasons.map((reason) =>
          typeof reason === 'object' && reason !== null && 'code' in reason
            ? reason.code
            : null
        )
      : [];
    expect(provider.calls).toBe(1);
    expect(second?.state).toBe(first?.state);
    expect(second?.rule_reasons).toEqual(first?.rule_reasons);
    expect(codes.filter((code) => code === 'AI_PRODUCT_NICHE')).toHaveLength(1);
    expect(decisions).toHaveLength(1);
  });


  it('keeps candidate decisions distinct while claiming the same analysis once', async () => {
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
    const first = await seedCandidates(client, ['batter squeeze bottle']);
    const second = await seedCandidates(client, ['batter squeeze bottle']);
    importRuns.push(first.importRunId, second.importRunId);
    const candidateIds = [...first.candidateIds, ...second.candidateIds];

    await runNormalizeJob(
      { candidateIds, locale: 'ko' },
      {
        client,
        provider,
        modelId: 'fake-normalizer-model',
        workerId: 'same-hash',
        promptVersion: `it-${randomUUID()}`
      }
    );

    const { data: analyses } = await client
      .from('ai_analyses')
      .select('id,input_hash')
      .eq('provider_id', provider.id);
    const { data: decisions } = await client
      .from('decision_history')
      .select('candidate_id,idempotency_key')
      .in('candidate_id', candidateIds);

    expect(provider.calls).toBe(1);
    expect(analyses).toHaveLength(1);
    expect(decisions).toHaveLength(2);
    expect(new Set(decisions?.map((decision) => decision.idempotency_key)).size).toBe(2);
  });

  it('calls the fake provider once when two workers race the same input', async () => {
    const held = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    class GatedProvider extends FakeNormalizationProvider {
      override async runStructured<T>(
        request: StructuredAiRequest<T>
      ): Promise<AiProviderResult<T>> {
        this.calls += 1;
        started.resolve();
        await held.promise;
        this.calls -= 1;
        return super.runStructured(request);
      }
    }
    const provider = new GatedProvider();
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
    const first = await seedCandidates(client, ['batter squeeze bottle']);
    const second = await seedCandidates(client, ['batter squeeze bottle']);
    importRuns.push(first.importRunId, second.importRunId);

    const promptVersion = `it-${randomUUID()}`;
    const jobA = runNormalizeJob(
      { candidateIds: first.candidateIds, locale: 'ko' },
      { client, provider, modelId: 'fake-normalizer-model', workerId: 'race-a', promptVersion }
    );
    await started.promise;
    const jobB = runNormalizeJob(
      { candidateIds: second.candidateIds, locale: 'ko' },
      { client, provider, modelId: 'fake-normalizer-model', workerId: 'race-b', promptVersion }
    );
    await expect(jobB).rejects.toThrow('AI analysis is already leased by another worker.');
    held.resolve();
    await jobA;

    expect(provider.calls).toBe(1);
  });

  it('renews an analysis lease so a second worker cannot start another provider call', async () => {
    class SlowProvider extends FakeNormalizationProvider {
      override async runStructured<T>(
        request: StructuredAiRequest<T>
      ): Promise<AiProviderResult<T>> {
        this.calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 1500));
        this.calls -= 1;
        return super.runStructured(request);
      }
    }
    const provider = new SlowProvider();
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
    const fixture = await seedCandidates(client, ['batter squeeze bottle']);
    importRuns.push(fixture.importRunId);
    const promptVersion = `it-${randomUUID()}`;
    const jobA = runNormalizeJob(
      { candidateIds: fixture.candidateIds, locale: 'ko' },
      {
        client,
        provider,
        modelId: 'fake-normalizer-model',
        workerId: 'lease-a',
        promptVersion,
        leaseSeconds: 1,
        heartbeatMs: 200
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await expect(
      runNormalizeJob(
        { candidateIds: fixture.candidateIds, locale: 'ko' },
        {
          client,
          provider,
          modelId: 'fake-normalizer-model',
          workerId: 'lease-b',
          promptVersion,
          leaseSeconds: 1
        }
      )
    ).rejects.toThrow('AI analysis is already leased by another worker.');
    await jobA;
    expect(provider.calls).toBe(1);
  });

  it('records durable usage after initial and repair structured failures', async () => {
    const attempt = (isRepair: boolean): RawAiProviderResult => ({
      rawOutput: '{"classification":"maybe"}',
      providerId: 'unused',
      modelId: 'usage-model',
      role: 'niche_normalization',
      inputHash: 'c'.repeat(64),
      usage: {
        inputTokens: 3,
        outputTokens: 4,
        totalTokens: 7,
        requestCount: 1
      },
      costClass: 'subscription',
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(1).toISOString(),
      ...(isRepair ? {} : {})
    });
    class BrokenStructuredProvider extends FakeNormalizationProvider {
      override async runStructured<T>(
        request: StructuredAiRequest<T>
      ): Promise<AiProviderResult<T>> {
        void request;
        this.calls += 1;
        throw new InvalidStructuredOutputError(
          {
            inputTokens: 6,
            outputTokens: 8,
            totalTokens: 14,
            requestCount: 2
          },
          [attempt(false), attempt(true)]
        );
      }
    }
    const provider = new BrokenStructuredProvider();
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
    await expect(
      runNormalizeJob(
        { candidateIds: fixture.candidateIds, locale: 'ko' },
        { client, provider, modelId: 'usage-model', promptVersion: `it-${randomUUID()}` }
      )
    ).rejects.toBeInstanceOf(InvalidStructuredOutputError);
    const { data: usage } = await client
      .from('ai_usage')
      .select('usage,provider_id,model_id,role')
      .eq('provider_id', provider.id);
    expect(usage).toHaveLength(1);
    expect(usage?.[0]?.model_id).toBe('usage-model');
    expect(usage?.[0]?.role).toBe('niche_normalization');
    expect(usage?.[0]?.usage).toMatchObject({ requestCount: 2, repairAttempted: true });
  });
  // Break: the full candidate projection omits migration-019 generation and cannot carry a nonzero value.
  it('selects normalization generation in the full candidate projection', async () => {
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
    if (providerError) throw providerError;
    const fixture = await seedCandidates(client, ['generation carrying dispenser']);
    importRuns.push(fixture.importRunId);
    const candidateId = fixture.candidateIds[0] ?? '';
    const { error: generationError } = await client
      .from('candidates')
      .update({ normalization_generation: 7 })
      .eq('id', candidateId);
    if (generationError) throw generationError;

    await runNormalizeJob(
      { candidateIds: fixture.candidateIds, locale: 'ko' },
      { client, provider, modelId: 'generation-model', promptVersion: `it-${randomUUID()}` }
    );
    const { data: candidate, error } = await client
      .from('candidates')
      .select('normalization_generation')
      .eq('id', candidateId)
      .single();
    if (error) throw error;
    expect(candidate.normalization_generation).toBe(7);
  });

  // Break: worker cluster persistence fabricates an English value instead of forwarding SQL NULL.
  it('forwards null canonical English unchanged', async () => {
    const provider = new NullableEnglishProvider();
    providers.push(provider.id);
    const { error: providerError } = await client.from('ai_providers').insert({
      id: provider.id,
      name: provider.id,
      kind: 'command',
      billing_type: 'free',
      enabled: true,
      config: {}
    });
    if (providerError) throw providerError;
    const fixture = await seedCandidates(client, ['nullable english product']);
    importRuns.push(fixture.importRunId);

    await runNormalizeJob(
      { candidateIds: fixture.candidateIds, locale: 'ko' },
      { client, provider, modelId: 'nullable-model', promptVersion: `it-${randomUUID()}` }
    );
    const { data: cluster, error } = await client
      .from('niche_clusters')
      .select('canonical_english')
      .eq('canonical_name', `Nullable English ${provider.id}`)
      .single();
    if (error) throw error;
    expect(cluster.canonical_english).toBeNull();
  });
});
