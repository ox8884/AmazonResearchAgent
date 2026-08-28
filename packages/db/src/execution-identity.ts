import { createHash } from 'node:crypto';
import type { Json } from './types';

export function providerExecutionFingerprint(input: {
  readonly kind: string;
  readonly baseUrl: string | null;
  readonly networkScope: string | null;
  readonly modelDiscovery: string | null;
  readonly manualModelId: string | null;
  readonly commandProfileId: string | null;
  readonly secretCipherId: string | null;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        kind: input.kind,
        baseUrl: input.baseUrl,
        networkScope: input.networkScope,
        modelDiscovery: input.modelDiscovery,
        manualModelId: input.manualModelId,
        commandProfileId: input.commandProfileId,
        secretCipherId: input.secretCipherId
      })
    )
    .digest('hex');
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
  return providerExecutionFingerprint({
    kind,
    baseUrl: read('baseUrl'),
    networkScope: read('networkScope'),
    modelDiscovery: read('modelDiscovery'),
    manualModelId: read('manualModelId') ?? read('modelId'),
    commandProfileId: read('commandProfileId'),
    secretCipherId: secretCipher
  });
}

