import { describe, expect, it } from 'vitest';
import {
  fingerprintFromProviderConfig,
  providerExecutionFingerprint
} from './execution-identity';

describe('provider execution identity', () => {
  // Break: subscription identity ignores a worker-owned auth, sandbox, or evidence binding.
  it('includes auth security and sandbox bindings in subscription fingerprints', () => {
    const base = {
      kind: 'subscription_command' as const,
      adapter: 'codex' as const,
      binaryDigest: 'binary-a',
      binaryVersion: '1.0.0',
      executionProfileId: 'codex-profile-v1',
      systemdUnitDigest: 'unit-a',
      securityProfileDigest: 'security-profile-a',
      authHomeIdentity: 'ara-codex:/var/lib/ara-codex',
      authGeneration: 3,
      settingsRevision: 4,
      securityProfileVersion: 'subscription-isolation-v1',
      readinessPolicyVersion: 'ready-lease-v1',
      endpointAllowlistDigest: 'endpoint-a',
      containmentBinding: 'containment-a',
      capabilityBinding: 'capability-a',
      termsDigest: 'terms-a'
    };
    const fingerprint = providerExecutionFingerprint(base);
    for (const [key, value] of [
      ['authGeneration', 5],
      ['systemdUnitDigest', 'unit-b'],
      ['securityProfileDigest', 'security-profile-b'],
      ['endpointAllowlistDigest', 'endpoint-b'],
      ['containmentBinding', 'containment-b'],
      ['capabilityBinding', 'capability-b'],
      ['termsDigest', 'terms-b']
    ] as const) {
      expect(providerExecutionFingerprint({ ...base, [key]: value })).not.toBe(fingerprint);
    }
  });

  // Break: existing HTTP provider fingerprints change during the family cutover.
  it('preserves the existing HTTP fingerprint', () => {
    const config = {
      baseUrl: 'https://api.example.com/v1',
      networkScope: 'public',
      modelDiscovery: 'disabled',
      manualModelId: 'gpt-4.1-mini'
    };
    expect(fingerprintFromProviderConfig('openai_http', config, 'cipher-a')).toBe(
      'c1fd1b21911eac3c8c518b0ae2be045a41b96366f5eecb1dc82e7c52b7f8e9cc'
    );
  });

  // Break: an unknown family is fingerprinted as HTTP or command with null fields.
  it('fails closed on unknown execution families', () => {
    expect(() => fingerprintFromProviderConfig('future_provider', {}, null)).toThrow(
      'Unsupported provider execution family.'
    );
  });
});
