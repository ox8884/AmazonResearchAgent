import { createHash } from 'node:crypto';
import type { Json } from './types';

type HttpExecutionFingerprintInput = {
  readonly kind: 'openai_http';
  readonly baseUrl: string | null;
  readonly networkScope: string | null;
  readonly modelDiscovery: string | null;
  readonly manualModelId: string | null;
  readonly commandProfileId: null;
  readonly secretCipherId: string | null;
};

type CommandExecutionFingerprintInput = {
  readonly kind: 'command';
  readonly baseUrl: null;
  readonly networkScope: null;
  readonly modelDiscovery: null;
  readonly manualModelId: string | null;
  readonly commandProfileId: string | null;
  readonly secretCipherId: null;
};

type SubscriptionExecutionFingerprintInput = {
  readonly kind: 'subscription_command';
  readonly adapter: 'codex' | 'grok';
  readonly binaryDigest: string;
  readonly binaryVersion: string;
  readonly executionProfileId: string;
  readonly systemdUnitDigest: string;
  readonly sandboxPolicyDigest: string;
  readonly authHomeIdentity: string;
  readonly authGeneration: number;
  readonly settingsRevision: number;
  readonly securityProfileVersion: string;
  readonly readinessPolicyVersion: string;
  readonly endpointAllowlistDigest: string;
  readonly containmentBinding: string;
  readonly capabilityBinding: string;
  readonly termsDigest: string;
};

export type ProviderExecutionFingerprintInput =
  | HttpExecutionFingerprintInput
  | CommandExecutionFingerprintInput
  | SubscriptionExecutionFingerprintInput;

export function providerExecutionFingerprint(
  input: ProviderExecutionFingerprintInput
): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}


export function secretCipherId(secret: {
  readonly ciphertext: string;
  readonly iv: string;
  readonly authTag?: string;
  readonly auth_tag?: string;
} | null): string | null {
  if (!secret) {
    return null;
  }
  const authTag = secret.authTag ?? secret.auth_tag ?? '';
  return createHash('sha256')
    .update(`${secret.ciphertext}:${secret.iv}:${authTag}`)
    .digest('hex');
}

export function fingerprintFromProviderConfig(
  kind: string,
  config: Json,
  secretCipher: string | null
): string {
  const record =
    typeof config === 'object' && config !== null && !Array.isArray(config)
      ? config
      : {};
  const read = (key: string): string | null => {
    const value = record[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  };
  if (kind === 'openai_http') {
    return providerExecutionFingerprint({
      kind,
      baseUrl: read('baseUrl'),
      networkScope: read('networkScope'),
      modelDiscovery: read('modelDiscovery'),
      manualModelId: read('manualModelId') ?? read('modelId'),
      commandProfileId: null,
      secretCipherId: secretCipher
    });
  }
  if (kind === 'command') {
    return providerExecutionFingerprint({
      kind,
      baseUrl: null,
      networkScope: null,
      modelDiscovery: null,
      manualModelId: read('modelId'),
      commandProfileId: read('commandProfileId'),
      secretCipherId: null
    });
  }
  throw new Error('Unsupported provider execution family.');
}

