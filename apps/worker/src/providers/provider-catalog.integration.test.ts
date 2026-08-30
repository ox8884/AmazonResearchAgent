import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import {
  createProviderRepository,
  createServerDatabaseClient,
  fingerprintFromProviderConfig,
  secretCipherId,
  type Json,
  type ProviderRow
} from '@ara/db';

import { routeAiRequest } from '@ara/ai-router';
import { AiRequestSchema } from '@ara/shared';
import { encryptSecret } from '@ara/secret-store';
import { afterEach, describe, expect, it } from 'vitest';
import { runProviderConnectionTest } from '../jobs/test-ai-provider';
import { resolvePersistedProviderCatalog } from './provider-catalog';


const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const integration = supabaseUrl && serviceRoleKey ? describe : describe.skip;

class MockOpenAiServer {
  readonly server: Server;
  readonly baseUrl: string;

  private constructor(server: Server, baseUrl: string) {
    this.server = server;
    this.baseUrl = baseUrl;
  }

  static async start(): Promise<MockOpenAiServer> {
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/v1/models') {
        response.end(JSON.stringify({ data: [{ id: 'catalog-model' }] }));
        return;
      }
      if (request.url === '/v1/chat/completions') {
        response.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            classification: 'product_niche',
            canonicalNiche: 'Batter / Pancake Dispenser',
            canonicalEnglish: 'Batter / Pancake Dispenser',
            catalogPhrases: ['pancake dispenser'],
            aliases: ['pancake dispenser bottle'],
            productFit: 'strong',
            riskFlags: [],
            confidence: 0.95,
            reason: 'Mock provider fixture.'
          }) } }],
          usage: { prompt_tokens: 4, completion_tokens: 8, total_tokens: 12 }
        }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'not found' }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    return new MockOpenAiServer(server, `http://127.0.0.1:${address.port}/v1`);
  }
}

function client() {
  return createServerDatabaseClient({
    url: supabaseUrl ?? 'http://127.0.0.1:54321',
    serviceRoleKey: serviceRoleKey ?? 'integration-test-not-configured'
  });
}

async function seedCandidate(
  database: ReturnType<typeof client>
): Promise<{ importRunId: string; candidateId: string }> {
  const importRunId = randomUUID();
  const rawId = randomUUID();
  const candidateId = randomUUID();
  const { error: importError } = await database.from('import_runs').insert({
    id: importRunId,
    submission_hash: `catalog-it-${importRunId}`,
    file_count: 1,
    total_row_count: 1,
    unique_keyword_count: 1,
    source_files: []
  });
  if (importError) throw importError;
  const { error: rawError } = await database.from('raw_opportunity_keywords').insert({
    id: rawId,
    import_run_id: importRunId,
    source_file_name: 'catalog-fixture.csv',
    source_hash: `catalog-source-${importRunId}`,
    source_row_number: 1,
    row_hash: `catalog-row-${importRunId}`,
    raw_row_text: 'pancake dispenser bottle',
    raw_row: { Keyword: 'pancake dispenser bottle' },
    parsed_row: { keyword: 'pancake dispenser bottle' },
    keyword: 'pancake dispenser bottle',
    normalized_exact_keyword: 'pancake dispenser bottle',
    is_exact_duplicate: false
  });
  if (rawError) throw rawError;
  const { error: candidateError } = await database.from('candidates').insert({
    id: candidateId,
    import_run_id: importRunId,
    representative_raw_keyword_id: rawId,
    keyword: 'pancake dispenser bottle',
    normalized_exact_keyword: 'pancake dispenser bottle',
    state: 'AI Screening',
    rule_passed: true,
    rule_reasons: [],
    risk_flags: [],
    preliminary_score: 80,
    preliminary_score_components: {},
    eligible_for_ai_normalization: true
  });
  if (candidateError) throw candidateError;
  return { importRunId, candidateId };
}

function probedConfig(
  baseConfig: Json,
  encrypted: { ciphertext: string; iv: string; authTag: string },
  available: boolean
): Json {
  const fingerprint = fingerprintFromProviderConfig(
    'openai_http',
    baseConfig,
    secretCipherId({
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag
    })
  );
  const record =
    typeof baseConfig === 'object' && baseConfig !== null && !Array.isArray(baseConfig)
      ? baseConfig
      : {};
  return {
    ...record,
    executionIdentity: fingerprint,
    executionProbe: {
      available,
      checkedAt: new Date(0).toISOString(),
      errorCategory: available ? null : 'provider_unavailable',
      fingerprint
    }
  };
}



integration('persisted provider catalog', () => {
  const database = client();
  const providerIds: string[] = [];
  const importRunIds: string[] = [];
  let mock: MockOpenAiServer | undefined;

  afterEach(async () => {
    mock?.server.close();
    mock = undefined;
    for (const providerId of providerIds.splice(0)) {
      await database.from('ai_usage').delete().eq('provider_id', providerId);
      await database.from('ai_analyses').delete().eq('provider_id', providerId);
      await database.from('ai_providers').delete().eq('id', providerId);
    }
    for (const importRunId of importRunIds.splice(0)) {
      await database.from('import_runs').delete().eq('id', importRunId);
    }
    const { data: clusters } = await database
      .from('niche_clusters')
      .select('id')
      .like('canonical_name', 'Batter / Pancake Dispenser%');
    const clusterIds = clusters?.map((cluster) => cluster.id) ?? [];
    if (clusterIds.length > 0) {
      await database.from('niche_cluster_keywords').delete().in('niche_cluster_id', clusterIds);
      await database.from('niche_clusters').delete().in('id', clusterIds);
    }
  });

  it('resolves persisted settings into a router catalog and normalization provider', async () => {
    mock = await MockOpenAiServer.start();
    const providerId = `catalog-provider-${randomUUID()}`;
    providerIds.push(providerId);
    const key = Buffer.alloc(32, 9);
    const encrypted = encryptSecret('persisted-secret-value', key);
    const repository = createProviderRepository(database);
    await repository.upsertProvider({
      id: providerId,
      name: 'Catalog mock provider',
      kind: 'openai_http',
      billing_type: 'subscription',
      enabled: true,
      priority: 1,
      config: (() => {
        const baseConfig = {
          baseUrl: mock.baseUrl,
          networkScope: 'loopback',
          modelDiscovery: 'disabled',
          manualModelId: 'catalog-model',
          roles: ['niche_normalization']
        };
        const fingerprint = fingerprintFromProviderConfig(
          'openai_http',
          baseConfig,
          secretCipherId({
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            authTag: encrypted.authTag
          })
        );
        return {
          ...baseConfig,
          executionIdentity: fingerprint,
          executionProbe: {
            available: true,
            checkedAt: new Date(0).toISOString(),
            errorCategory: null,
            fingerprint
          }
        };
      })()
    });
    await repository.upsertModel({
      provider_id: providerId,
      model_id: 'catalog-model',
      display_name: 'Catalog model',
      capabilities: ['structured_json', 'chat_completions', 'health'],
      billing_type: 'subscription',
      quality_rank: 1
    });
    await repository.upsertSecret({
      provider_id: providerId,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      last4: encrypted.last4
    });

    const catalog = await resolvePersistedProviderCatalog(database, { encryptionKey: key });
    const request = AiRequestSchema.parse({
      role: 'niche_normalization',
      routerMode: 'Balanced',
      locale: 'ko',
      payload: { keyword: 'pancake dispenser bottle' }
    });
    const decision = routeAiRequest(request, catalog);
    if (decision.kind !== 'route') {
      throw new Error('Expected the persisted provider to be routable.');
    }
    const fixture = await seedCandidate(database);
    importRunIds.push(fixture.importRunId);

    expect(decision.providerId).toBe(providerId);
    expect(fixture.candidateId).toBeTruthy();
    expect(JSON.stringify(catalog)).not.toContain('persisted-secret-value');
    expect(JSON.stringify(decision.provider)).not.toContain('persisted-secret-value');
  });

  it('isolates a malformed provider and excludes disabled models', async () => {
    mock = await MockOpenAiServer.start();
    const goodId = `catalog-provider-${randomUUID()}`;
    const badId = `catalog-provider-${randomUUID()}`;
    providerIds.push(goodId, badId);
    const key = Buffer.alloc(32, 9);
    const encrypted = encryptSecret('persisted-secret-value', key);
    const repository = createProviderRepository(database);
    await repository.upsertProvider({
      id: badId,
      name: 'Malformed provider',
      kind: 'openai_http',
      billing_type: 'subscription',
      enabled: true,
      priority: 1,
      config: { baseUrl: 'http://127.0.0.1:9/v1', roles: ['niche_normalization'] }
    });
    await repository.upsertProvider({
      id: goodId,
      name: 'Healthy provider',
      kind: 'openai_http',
      billing_type: 'subscription',
      enabled: true,
      priority: 1,
      config: (() => {
        const baseConfig = {
          baseUrl: mock.baseUrl,
          networkScope: 'loopback',
          modelDiscovery: 'disabled',
          manualModelId: 'enabled-model',
          roles: ['niche_normalization']
        };
        const fingerprint = fingerprintFromProviderConfig(
          'openai_http',
          baseConfig,
          secretCipherId({
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            authTag: encrypted.authTag
          })
        );
        return {
          ...baseConfig,
          executionIdentity: fingerprint,
          executionProbe: {
            available: true,
            checkedAt: new Date(0).toISOString(),
            errorCategory: null,
            fingerprint
          }
        };
      })()
    });
    await repository.upsertModel({
      provider_id: goodId,
      model_id: 'enabled-model',
      display_name: 'Enabled',
      capabilities: ['structured_json', 'chat_completions', 'health'],
      billing_type: 'subscription',
      quality_rank: 1,
      enabled: true
    });
    await repository.upsertModel({
      provider_id: goodId,
      model_id: 'disabled-model',
      display_name: 'Disabled',
      capabilities: ['structured_json', 'chat_completions', 'health'],
      billing_type: 'subscription',
      quality_rank: 2,
      enabled: false
    });
    await repository.upsertSecret({
      provider_id: goodId,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      last4: encrypted.last4
    });

    const catalog = await resolvePersistedProviderCatalog(database, { encryptionKey: key });
    const entry = catalog.entries.find((candidate) => candidate.provider.id === goodId);

    expect(catalog.entries.map((candidate) => candidate.provider.id)).toEqual([goodId]);
    expect(entry?.models.map((model) => model.id)).toEqual(['enabled-model']);
  });

  // Break: a failed Test Connection keeps a previous success probe routable.
  it('does not route a provider after a failed execution probe', async () => {
    mock = await MockOpenAiServer.start();
    const providerId = `catalog-provider-${randomUUID()}`;
    providerIds.push(providerId);
    const key = Buffer.alloc(32, 9);
    const encrypted = encryptSecret('persisted-secret-value', key);
    const repository = createProviderRepository(database);
    const baseConfig = {
      baseUrl: mock.baseUrl,
      networkScope: 'loopback',
      modelDiscovery: 'disabled',
      manualModelId: 'catalog-model',
      roles: ['niche_normalization']
    };
    await repository.upsertProvider({
      id: providerId,
      name: 'Failed probe provider',
      kind: 'openai_http',
      billing_type: 'subscription',
      enabled: true,
      priority: 1,
      config: probedConfig(baseConfig, encrypted, false)
    });
    await repository.upsertModel({
      provider_id: providerId,
      model_id: 'catalog-model',
      display_name: 'Catalog model',
      capabilities: ['structured_json', 'chat_completions', 'health'],
      billing_type: 'subscription',
      quality_rank: 1
    });
    await repository.upsertSecret({
      provider_id: providerId,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      last4: encrypted.last4
    });

    const catalog = await resolvePersistedProviderCatalog(database, { encryptionKey: key });
    const decision = routeAiRequest(
      AiRequestSchema.parse({
        role: 'niche_normalization',
        routerMode: 'Balanced',
        locale: 'ko',
        payload: { keyword: 'pancake dispenser bottle' }
      }),
      catalog
    );
    expect(decision.kind).not.toBe('route');
  });

  // Break: a Test Connection for config A stamps its probe onto concurrent config B.
  it('rejects a stale execution probe after a concurrent settings change', async () => {
    mock = await MockOpenAiServer.start();
    const providerId = `catalog-provider-${randomUUID()}`;
    providerIds.push(providerId);
    const key = Buffer.alloc(32, 9);
    const encrypted = encryptSecret('persisted-secret-value', key);
    const repository = createProviderRepository(database);
    const baseConfig = {
      baseUrl: mock.baseUrl,
      networkScope: 'loopback',
      modelDiscovery: 'disabled',
      manualModelId: 'catalog-model',
      roles: ['niche_normalization']
    };
    await repository.upsertProvider({
      id: providerId,
      name: 'Race probe provider',
      kind: 'openai_http',
      billing_type: 'subscription',
      enabled: true,
      priority: 1,
      config: {
        ...baseConfig,
        executionIdentity: fingerprintFromProviderConfig(
          'openai_http',
          baseConfig,
          secretCipherId({
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            authTag: encrypted.authTag
          })
        )
      }
    });
    await repository.upsertModel({
      provider_id: providerId,
      model_id: 'catalog-model',
      display_name: 'Catalog model',
      capabilities: ['structured_json', 'chat_completions', 'health'],
      billing_type: 'subscription',
      quality_rank: 1
    });
    await repository.upsertSecret({
      provider_id: providerId,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      last4: encrypted.last4
    });

    await runProviderConnectionTest(providerId, database, {
      encryptionKey: key,
      beforePersist: async () => {
        const current = await repository.findProvider(providerId);
        if (!current) {
          throw new Error('Expected the raced provider to exist.');
        }
        const previous =
          typeof current.config === 'object' &&
          current.config !== null &&
          !Array.isArray(current.config)
            ? current.config
            : {};
        await repository.saveSettings({
          provider: {
            ...current,
            config: {
              ...previous,
              baseUrl: 'http://127.0.0.1:9/v1',
              executionIdentity: 'config-b'
            }
          },
          secret: null,
          models: [],
          reconcileMode: 'none',
          expectedRevision: current.settings_revision
        });
      }
    });

    const raced = await repository.findProvider(providerId);
    const racedConfig =
      typeof raced?.config === 'object' && raced.config !== null && !Array.isArray(raced.config)
        ? raced.config
        : {};
    const catalog = await resolvePersistedProviderCatalog(database, { encryptionKey: key });
    const decision = routeAiRequest(
      AiRequestSchema.parse({
        role: 'niche_normalization',
        routerMode: 'Balanced',
        locale: 'ko',
        payload: { keyword: 'pancake dispenser bottle' }
      }),
      catalog
    );

    expect(racedConfig.baseUrl).toBe('http://127.0.0.1:9/v1');
    expect(racedConfig.executionIdentity).toBe('config-b');
    expect(
      typeof racedConfig.executionProbe === 'object' &&
        racedConfig.executionProbe !== null &&
        !Array.isArray(racedConfig.executionProbe)
        ? racedConfig.executionProbe['available']
        : undefined
    ).not.toBe(true);
    expect(decision.kind).not.toBe('route');
  });

  // Break: adapter A is executed but the later fingerprint/CAS is for concurrent config B.
  it('does not mark config B tested after executing adapter A', async () => {
    mock = await MockOpenAiServer.start();
    const providerId = `catalog-provider-${randomUUID()}`;
    providerIds.push(providerId);
    const key = Buffer.alloc(32, 9);
    const encrypted = encryptSecret('persisted-secret-value', key);
    const repository = createProviderRepository(database);
    const baseConfig = {
      baseUrl: mock.baseUrl,
      networkScope: 'loopback',
      modelDiscovery: 'disabled',
      manualModelId: 'catalog-model',
      roles: ['niche_normalization']
    };
    await repository.upsertProvider({
      id: providerId,
      name: 'Adapter race provider',
      kind: 'openai_http',
      billing_type: 'subscription',
      enabled: true,
      priority: 1,
      config: {
        ...baseConfig,
        executionIdentity: fingerprintFromProviderConfig(
          'openai_http',
          baseConfig,
          secretCipherId({
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            authTag: encrypted.authTag
          })
        )
      }
    });
    await repository.upsertModel({
      provider_id: providerId,
      model_id: 'catalog-model',
      display_name: 'Catalog model',
      capabilities: ['structured_json', 'chat_completions', 'health'],
      billing_type: 'subscription',
      quality_rank: 1
    });
    await repository.upsertSecret({
      provider_id: providerId,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      last4: encrypted.last4
    });

    await runProviderConnectionTest(providerId, database, {
      encryptionKey: key,
      afterSnapshot: async () => {
        const current = await repository.findProvider(providerId);
        if (!current) {
          throw new Error('Expected the raced provider to exist.');
        }
        const secret = await repository.findSecret(providerId);
        const nextConfig = {
          baseUrl: 'http://127.0.0.1:9/v1',
          networkScope: 'loopback',
          modelDiscovery: 'disabled',
          manualModelId: 'catalog-model',
          roles: ['niche_normalization']
        };
        const nextIdentity = fingerprintFromProviderConfig(
          'openai_http',
          nextConfig,
          secretCipherId(secret)
        );
        await repository.saveSettings({
          provider: {
            ...current,
            config: {
              ...nextConfig,
              executionIdentity: nextIdentity
            }
          },
          secret: null,
          models: [],
          reconcileMode: 'none',
          expectedRevision: current.settings_revision
        });
      }
    });

    const raced = await repository.findProvider(providerId);
    const racedConfig =
      typeof raced?.config === 'object' && raced.config !== null && !Array.isArray(raced.config)
        ? raced.config
        : {};
    const catalog = await resolvePersistedProviderCatalog(database, { encryptionKey: key });
    const decision = routeAiRequest(
      AiRequestSchema.parse({
        role: 'niche_normalization',
        routerMode: 'Balanced',
        locale: 'ko',
        payload: { keyword: 'pancake dispenser bottle' }
      }),
      catalog
    );

    expect(racedConfig.baseUrl).toBe('http://127.0.0.1:9/v1');
    expect(typeof racedConfig.executionIdentity).toBe('string');
    expect(racedConfig.executionIdentity).not.toBe(
      fingerprintFromProviderConfig(
        'openai_http',
        baseConfig,
        secretCipherId({
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag
        })
      )
    );
    expect(
      typeof racedConfig.executionProbe === 'object' &&
        racedConfig.executionProbe !== null &&
        !Array.isArray(racedConfig.executionProbe)
        ? racedConfig.executionProbe['available']
        : undefined
    ).not.toBe(true);
    expect(decision.kind).not.toBe('route');
  });

  // Break: unsupported persisted provider families or mixed-version shapes fall through to an executable adapter.
  it('fails closed on unknown mixed-version provider kinds', async () => {
    const repository = createProviderRepository(database);
    const base: ProviderRow = {
      id: `mixed-version-${randomUUID()}`,
      name: 'Unsupported mixed-version provider',
      kind: 'future_provider',
      adapter: null,
      billing_type: 'subscription',
      enabled: true,
      priority: 1,
      config: { commandProfileId: 'legacy-command', modelId: 'legacy-model' },
      settings_revision: 1,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString()
    };
    const catalog = await resolvePersistedProviderCatalog(null, {
      providerRepository: {
        ...repository,
        listProviders: async () => [
          base,
          {
            ...base,
            id: `${base.id}-subscription`,
            kind: 'subscription_command',
            adapter: null,
            config: { commandProfileId: 'legacy-command', modelId: 'legacy-model' }
          }
        ],
        listModels: async () => [],
        listRuntimeStates: async () => [],
        listSecrets: async () => []
      }
    });

    expect(catalog.entries).toEqual([]);
  });
});


