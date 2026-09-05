import { describe, expect, it } from 'vitest';
import {
  AI_PROVIDER_PRODUCT_OPTIONS,
  aiProviderProductFields
} from '../../../packages/shared/src/i18n';
import { providerFormKey } from './ai-provider-form-key';
import { clearProviderTestResult, waitForProviderTest } from './ai-provider-form-model';


describe('AI provider form identity', () => {
  // Break: refreshing the same provider ID keeps stale defaultValue DOM.
  it('changes the form key when settings revision changes', () => {
    expect(providerFormKey(null)).toBe('new');
    expect(
      providerFormKey({ id: 'provider-a', settingsRevision: 4 })
    ).toBe('provider-a:4');
    expect(
      providerFormKey({ id: 'provider-a', settingsRevision: 5 })
    ).toBe('provider-a:5');
  });
});

describe('product-safe AI provider form', () => {
  // Break: the product selector exposes raw execution families or test-only command providers.
  it('offers exactly the three approved product choices', () => {
    expect(AI_PROVIDER_PRODUCT_OPTIONS).toEqual([
      { value: 'codex_subscription', label: 'OpenAI Codex Subscription' },
      { value: 'grok_subscription', label: 'Grok Subscription' },
      { value: 'openai_compatible_api', label: 'OpenAI-Compatible API' }
    ]);
    expect(JSON.stringify(AI_PROVIDER_PRODUCT_OPTIONS)).not.toMatch(/subscription_command|command provider/u);
  });

  // Break: subscription choices reveal API secrets, endpoints, model IDs, roles, or activation controls.
  it('shows implementation fields only for the HTTP product', () => {
    expect(aiProviderProductFields('codex_subscription')).toEqual({
      httpCredentials: false,
      modelConfiguration: false,
      roleSelection: false,
      activation: false
    });
    expect(aiProviderProductFields('grok_subscription')).toEqual({
      httpCredentials: false,
      modelConfiguration: false,
      roleSelection: false,
      activation: false
    });
    expect(aiProviderProductFields('openai_compatible_api')).toEqual({
      httpCredentials: true,
      modelConfiguration: true,
      roleSelection: true,
      activation: true
    });
  });
});

describe('provider test polling', () => {
  it('rejects a response owned by another test job', async () => {
    expect(await waitForProviderTest('requested-job', {
      getResult: async () => ({ jobId: 'other-job', status: 'completed',
        result: { providerTest: { available: true, models: [] } }, errorCategory: null })
    })).toEqual({ kind: 'inconclusive' });
  });

  it('keeps a queued subscription probe inconclusive', async () => {
    expect(await waitForProviderTest('probe-job', {
      getResult: async () => ({ jobId: 'probe-job', status: 'completed',
        result: { providerTest: { available: false, models: [], errorCategory: 'provider_probe_requested' } }, errorCategory: null })
    })).toEqual({ kind: 'inconclusive' });
  });
  it('keeps an expired wait distinct from a failed provider connection', async () => {
    const result = await waitForProviderTest('job-timeout', {
      maxAttempts: 1,
      getResult: async () => ({
        jobId: 'job-timeout',
        status: 'running',
        result: null,
        errorCategory: null
      }),
      pause: async () => undefined
    });

    expect(result).toEqual({ kind: 'timed_out' });
  });

  it('returns the completed result only for the tested job', async () => {
    const result = await waitForProviderTest('job-provider-a', {
      getResult: async (jobId) => ({
        jobId,
        status: 'completed',
        result: { providerTest: { available: true, models: ['model-a'] } },
        errorCategory: null
      }),
      pause: async () => undefined
    });

    expect(result).toEqual({
      kind: 'completed',
      available: true,
      models: ['model-a'],
      errorCategory: null
    });
  });

  it('removes only the saved provider result when its settings revision changes', () => {
    const retained = { kind: 'timed_out' } as const;
    expect(clearProviderTestResult({
      'provider-a': { kind: 'completed', available: true, models: ['model-a'], errorCategory: null },
      'provider-b': retained
    }, 'provider-a')).toEqual({ 'provider-b': retained });
  });
});
