import { describe, expect, it } from 'vitest';
import {
  ApprovedCommandProfileIds,
  resolveApprovedCommandProfile
} from './command-profiles';

describe('worker command profile registry', () => {
  // Break: an unknown browser-supplied profile becomes an executable command.
  it('rejects command profiles not approved by the worker', () => {
    expect(() =>
      resolveApprovedCommandProfile(
        'powershell.exe -Command whoami',
        'provider-1',
        'model-1',
        'subscription'
      )
    ).toThrow('Command profile is not approved on this worker.');
  });

  // Break: development exposes an arbitrary executable instead of the fixed fake profile.
  it('resolves the development fake profile to fixed Node arguments', () => {
    expect(ApprovedCommandProfileIds).toContain('fake-command');

    const profile = resolveApprovedCommandProfile(
      'fake-command',
      'provider-1',
      'model-1',
      'free'
    );

    expect(profile).toMatchObject({
      id: 'provider-1',
      modelId: 'model-1',
      executable: process.execPath,
      environmentAllowlist: [],
      fixedEnvironment: {}
    });
    expect(profile.fixedArgs).toHaveLength(1);
    expect(profile.fixedArgs[0]).toMatch(/fake-ai-command\.mjs$/u);
  });
});
