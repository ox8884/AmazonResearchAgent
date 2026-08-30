import { describe, expect, it } from 'vitest';
import {
  AI_PROVIDER_PRODUCT_OPTIONS,
  aiProviderProductFields
} from '../../../packages/shared/src/i18n';
import { providerFormKey } from './ai-provider-form-key';


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
