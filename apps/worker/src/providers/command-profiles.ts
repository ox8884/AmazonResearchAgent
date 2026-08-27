import { fileURLToPath } from 'node:url';
import type { CommandProviderConfig } from '@ara/ai-router';
import type { BillingType } from '@ara/shared';

export interface ApprovedCommandProfile {
  readonly id: string;
  readonly enabled: boolean;
  readonly executable: string;
  readonly fixedArgs: readonly string[];
  readonly healthArgs: readonly string[];
  readonly promptMode: 'stdin' | 'final_arg';
  readonly outputMode: 'json' | 'text_to_json';
  readonly environmentAllowlist: readonly string[];
  readonly fixedEnvironment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

const fakeCommandPath = fileURLToPath(
  new URL('../../../../tests/fixtures/fake-ai-command.mjs', import.meta.url)
);

const profiles: Readonly<Record<string, ApprovedCommandProfile>> = {
  'fake-command': {
    id: 'fake-command',
    enabled: process.env.NODE_ENV !== 'production',
    executable: process.execPath,
    fixedArgs: [fakeCommandPath],
    healthArgs: ['--version'],
    promptMode: 'stdin',
    outputMode: 'json',
    environmentAllowlist: [],
    fixedEnvironment: {},
    timeoutMs: 60_000
  }
};

export function resolveApprovedCommandProfile(
  profileId: string,
  providerId: string,
  modelId: string,
  billingType: BillingType
): CommandProviderConfig {
  const profile = profiles[profileId];
  if (!profile?.enabled) {
    throw new Error('Command profile is not approved on this worker.');
  }
  return {
    id: providerId,
    billingType,
    executable: profile.executable,
    fixedArgs: profile.fixedArgs,
    healthArgs: profile.healthArgs,
    modelId,
    promptMode: profile.promptMode,
    outputMode: profile.outputMode,
    environmentAllowlist: profile.environmentAllowlist,
    fixedEnvironment: profile.fixedEnvironment,
    timeoutMs: profile.timeoutMs
  };
}

export const ApprovedCommandProfileIds = Object.freeze(
  Object.keys(profiles).filter((id) => profiles[id]?.enabled)
);
