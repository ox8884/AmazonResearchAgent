import { describe, expect, it } from 'vitest';
import { createProviderRepository } from './provider-repository';

const rpcSnapshot = {
  id: 'provider-a',
  name: 'Provider A',
  kind: 'openai_http',
  billing_type: 'subscription',
  enabled: true,
  priority: 1,
  config: { executionIdentity: 'fp-a' },
  settings_revision: 4,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString()
};

const laterRow = {
  ...rpcSnapshot,
  settings_revision: 5,
  name: 'Provider B'
};

function settingsClient() {
  return {
    rpc: async () => ({ data: rpcSnapshot, error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: laterRow, error: null })
        })
      })
    })
  };
}

describe('provider settings repository', () => {
  // Break: saveSettings discards the atomic RPC row and returns a later SELECT.
  it('returns the committed settings snapshot instead of a newer row', async () => {
    const repository = createProviderRepository(settingsClient() as never);
    const saved = await repository.saveSettings({
      provider: {
        id: 'provider-a',
        name: 'Provider A',
        kind: 'openai_http',
        billing_type: 'subscription'
      },
      secret: null,
      models: [],
      reconcileMode: 'none',
      expectedRevision: 3
    });
    expect(saved.settings_revision).toBe(4);
    expect(saved.name).toBe('Provider A');
  });
});
