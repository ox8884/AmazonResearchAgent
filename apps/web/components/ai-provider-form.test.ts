import { describe, expect, it } from 'vitest';
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
