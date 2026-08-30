import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServerDatabaseClient } from '@ara/db';
import { routeAiRequest } from '@ara/ai-router';
import { AiRequestSchema } from '@ara/shared';
import { runNormalizeJob } from '../../../../worker/src/jobs/normalize-opportunities';
import { runProviderConnectionTest } from '../../../../worker/src/jobs/test-ai-provider';
import { resolvePersistedProviderCatalog } from '../../../../worker/src/providers/provider-catalog';
import {
  createAdminSession,
  hashAdminPassword
} from '../../../lib/server/admin-session';
import { GET, POST } from './route';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const integration = supabaseUrl && serviceRoleKey ? describe : describe.skip;

const PLAINTEXT_SECRET = 'settings-api-secret-value';
const originalEnvironment = {
  ADMIN_PASSWORD_SCRYPT: process.env.ADMIN_PASSWORD_SCRYPT,
  APP_SESSION_SIGNING_KEY_B64: process.env.APP_SESSION_SIGNING_KEY_B64,
  APP_SECRET_ENCRYPTION_KEY_B64: process.env.APP_SECRET_ENCRYPTION_KEY_B64,
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET
};

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
        response.end(JSON.stringify({ data: [{ id: 'settings-model' }] }));
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
            reason: 'Settings API fixture.'
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

function database() {
  return createServerDatabaseClient({
    url: supabaseUrl ?? 'http://127.0.0.1:54321',
    serviceRoleKey: serviceRoleKey ?? 'integration-test-not-configured'
  });
}

async function seedCandidate(): Promise<{ importRunId: string; candidateId: string }> {
  const client = database();
  const importRunId = randomUUID();
  const rawId = randomUUID();
  const candidateId = randomUUID();
  const { error: importError } = await client.from('import_runs').insert({
    id: importRunId,
    submission_hash: `settings-it-${importRunId}`,
    file_count: 1,
    total_row_count: 1,
    unique_keyword_count: 1,
    source_files: []
  });
  if (importError) throw importError;
  const { error: rawError } = await client.from('raw_opportunity_keywords').insert({
    id: rawId,
    import_run_id: importRunId,
    source_file_name: 'settings-fixture.csv',
    source_hash: `settings-source-${importRunId}`,
    source_row_number: 1,
    row_hash: `settings-row-${importRunId}`,
    raw_row_text: 'pancake dispenser bottle',
    raw_row: { Keyword: 'pancake dispenser bottle' },
    parsed_row: { keyword: 'pancake dispenser bottle' },
    keyword: 'pancake dispenser bottle',
    normalized_exact_keyword: 'pancake dispenser bottle',
    is_exact_duplicate: false
  });
  if (rawError) throw rawError;
  const { error: candidateError } = await client.from('candidates').insert({
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

async function authenticatedRequest(
  method: 'GET' | 'POST',
  body?: unknown
): Promise<Response> {
  const signingKey = Buffer.from(process.env.APP_SESSION_SIGNING_KEY_B64 ?? '', 'base64');
  const issued = createAdminSession(signingKey);
  return (method === 'GET' ? GET : POST)(
    new Request('http://127.0.0.1/api/ai-providers', {
      method,
      headers: {
        origin: 'http://127.0.0.1',
        host: '127.0.0.1',
        'content-type': 'application/json',
        cookie: `ara_admin_session=${issued.token}; ara_csrf=${issued.csrfToken}`,
        'x-csrf-token': issued.csrfToken
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
  );
}

integration('settings API to worker catalog', () => {
  const encryptionKey = Buffer.alloc(32, 11);
  const client = database();
  const providerIds: string[] = [];
  const importRunIds: string[] = [];
  let mock: MockOpenAiServer | undefined;

  beforeEach(async () => {
    process.env.ADMIN_PASSWORD_SCRYPT = await hashAdminPassword(
      'settings-integration-password',
      Buffer.alloc(16, 4)
    );
    process.env.APP_SESSION_SIGNING_KEY_B64 = Buffer.alloc(32, 6).toString('base64');
    process.env.APP_SECRET_ENCRYPTION_KEY_B64 = encryptionKey.toString('base64');
    process.env.SUPABASE_STORAGE_BUCKET = 'opportunity-imports';
  });

  afterEach(async () => {
    mock?.server.close();
    mock = undefined;
    for (const providerId of providerIds.splice(0)) {
      await client.from('ai_usage').delete().eq('provider_id', providerId);
      await client.from('ai_analyses').delete().eq('provider_id', providerId);
      await client.from('ai_providers').delete().eq('id', providerId);
    }
    for (const importRunId of importRunIds.splice(0)) {
      await client.from('import_runs').delete().eq('id', importRunId);
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
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  // Break: saved settings never become a live worker catalog route, or plaintext leaks.
  it('persists an authenticated provider and normalizes through the worker catalog', async () => {
    mock = await MockOpenAiServer.start();
    const providerId = `settings-provider-${randomUUID()}`;
    providerIds.push(providerId);

    const saved = await authenticatedRequest('POST', {
      id: providerId,
      name: 'Settings integration provider',
      kind: 'openai_http',
      billingType: 'subscription',
      baseUrl: mock.baseUrl,
      networkScope: 'loopback',
      apiKey: PLAINTEXT_SECRET,
      modelId: 'settings-model',
      roles: ['niche_normalization'],
      enabled: true
    });
    const savedBody = await saved.json() as {
      provider: {
        id: string;
        secretLast4: string | null;
        roles: readonly string[];
        models: readonly { id: string }[];
      };
    };
    const listed = await authenticatedRequest('GET');
    const listedBody = await listed.json() as { providers: unknown };

    const { data: providerRow } = await client
      .from('ai_providers')
      .select('id,kind,config')
      .eq('id', providerId)
      .single();
    const { data: secretRow } = await client
      .from('provider_secrets')
      .select('ciphertext,last4')
      .eq('provider_id', providerId)
      .single();
    const { data: modelRow } = await client
      .from('ai_models')
      .select('model_id,enabled')
      .eq('provider_id', providerId)
      .single();
    const probed = await runProviderConnectionTest(providerId, client, {
      encryptionKey
    });
    expect(probed.available).toBe(true);
    const catalog = await resolvePersistedProviderCatalog(client, { encryptionKey });
    const decision = routeAiRequest(
      AiRequestSchema.parse({
        role: 'niche_normalization',
        routerMode: 'Balanced',
        locale: 'ko',
        payload: { keyword: 'pancake dispenser bottle' }
      }),
      catalog
    );
    const fixture = await seedCandidate();
    importRunIds.push(fixture.importRunId);
    if (decision.kind !== 'route') {
      throw new Error('Expected the settings-persisted provider to be routable.');
    }
    const result = await runNormalizeJob(
      { candidateIds: [fixture.candidateId], locale: 'ko', normalizationGeneration: 0 },
      {
        client,
        provider: decision.provider,
        modelId: decision.model.id,
        promptVersion: `it-${randomUUID()}`
      }
    );
    const { data: candidate } = await client
      .from('candidates')
      .select('state')
      .eq('id', fixture.candidateId)
      .single();

    expect(saved.status).toBe(201);
    expect(listed.status).toBe(200);
    expect(savedBody.provider.id).toBe(providerId);
    expect(savedBody.provider.secretLast4).toBe('alue');
    expect(savedBody.provider.roles).toEqual(['niche_normalization']);
    expect(savedBody.provider.models.map((model) => model.id)).toContain('settings-model');
    expect(JSON.stringify(savedBody)).not.toContain(PLAINTEXT_SECRET);
    expect(JSON.stringify(listedBody)).not.toContain(PLAINTEXT_SECRET);
    expect(providerRow).toMatchObject({ id: providerId, kind: 'openai_http' });
    expect(JSON.stringify(providerRow)).not.toContain(PLAINTEXT_SECRET);
    expect(secretRow?.ciphertext).not.toContain(PLAINTEXT_SECRET);
    expect(secretRow?.last4).toBe('alue');
    expect(modelRow).toMatchObject({ model_id: 'settings-model', enabled: true });
    expect(decision.providerId).toBe(providerId);
    expect(JSON.stringify(catalog)).not.toContain(PLAINTEXT_SECRET);
    expect(JSON.stringify(decision.provider)).not.toContain(PLAINTEXT_SECRET);
    expect(result.clusteredCount).toBe(1);
    expect(candidate?.state).toBe('Ready for API Validation');
  });
});
