import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  CODEX_SUBSCRIPTION_IDENTITY,
  GROK_SUBSCRIPTION_IDENTITY,
  CodexSubscriptionError,
  GrokSetupRequiredError,
  type CodexAuthHomeIdentity,
  type CodexBinaryIdentity,
  type CodexExecutionProfile,
  type GrokAuthHomeIdentity,
  type GrokBinaryIdentity,
  type GrokExecutionProfile
} from '@ara/ai-router';


export const CODEX_SUBSCRIPTION_MANIFEST = Object.freeze({
  adapter: 'codex' as const,
  activation: 'disabled' as const,
  profileId: CODEX_SUBSCRIPTION_IDENTITY.profileId,
  modelId: CODEX_SUBSCRIPTION_IDENTITY.modelId,
  unitTemplate: CODEX_SUBSCRIPTION_IDENTITY.unitTemplate,
  invocationRoot: CODEX_SUBSCRIPTION_IDENTITY.invocationRoot,
  binaryPath: CODEX_SUBSCRIPTION_IDENTITY.binaryPath,
  fixedClientArguments: Object.freeze([
    '--fixed-profile',
    CODEX_SUBSCRIPTION_IDENTITY.profileId
  ]),
  environment: Object.freeze({}),
  authHomePath: CODEX_SUBSCRIPTION_IDENTITY.authHomePath,
  policyDigest: CODEX_SUBSCRIPTION_IDENTITY.policyDigest
});

export const GROK_SUBSCRIPTION_MANIFEST = Object.freeze({
  adapter: 'grok' as const,
  activation: 'disabled' as const,
  clientAcceptance: 'setup_required' as const,
  profileId: GROK_SUBSCRIPTION_IDENTITY.profileId,
  modelId: GROK_SUBSCRIPTION_IDENTITY.acceptedModelId,
  unitTemplate: GROK_SUBSCRIPTION_IDENTITY.unitTemplate,
  invocationRoot: GROK_SUBSCRIPTION_IDENTITY.invocationRoot,
  binaryPath: GROK_SUBSCRIPTION_IDENTITY.binaryPath,
  fixedClientArguments: Object.freeze([
    '--fixed-profile',
    GROK_SUBSCRIPTION_IDENTITY.profileId
  ]),
  environment: Object.freeze({}),
  authHomePath: GROK_SUBSCRIPTION_IDENTITY.authHomePath,
  policyDigest: GROK_SUBSCRIPTION_IDENTITY.policyDigest
});

export interface InspectSubscriptionBinaryOptions {
  readonly expectedUid?: number | undefined;
  readonly expectedGid?: number | undefined;
  readonly expectedMode: number;
  readonly expectedVersion: string;
  readonly expectedSha256?: string | undefined;
  readonly readVersion: (path: string) => Promise<string>;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function binaryMismatch(message: string, cause?: unknown): CodexSubscriptionError {
  return new CodexSubscriptionError(
    message,
    'binary_identity_mismatch',
    false,
    cause
  );
}

export async function inspectSubscriptionBinary(
  path: string,
  options: InspectSubscriptionBinaryOptions
): Promise<CodexBinaryIdentity> {
  if (!isAbsolute(path)) {
    throw binaryMismatch('Subscription binary path must be absolute.');
  }
  let handle: FileHandle | undefined;
  try {
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink()) {
      throw binaryMismatch('Subscription binary must be a regular non-symlink file.');
    }
    handle = await open(path, 'r');
    const current = await handle.stat();
    if (
      !current.isFile() ||
      current.dev !== before.dev ||
      current.ino !== before.ino ||
      (options.expectedUid !== undefined && current.uid !== options.expectedUid) ||
      (options.expectedGid !== undefined && current.gid !== options.expectedGid) ||
      (process.platform !== 'win32' && (current.mode & 0o7777) !== options.expectedMode)
    ) {
      throw binaryMismatch('Subscription binary ownership or mode does not match.');
    }
    if (await realpath(path) !== path) {
      throw binaryMismatch('Subscription binary canonical path does not match.');
    }
    const [version, sha256] = await Promise.all([
      options.readVersion(path),
      sha256File(path)
    ]);
    if (
      version !== options.expectedVersion ||
      (options.expectedSha256 !== undefined && sha256 !== options.expectedSha256)
    ) {
      throw binaryMismatch('Subscription binary version or digest does not match.');
    }
    return {
      path,
      ownerUid: current.uid,
      ownerGid: current.gid,
      mode: current.mode & 0o7777,
      version,
      sha256
    };
  } catch (cause) {
    if (cause instanceof CodexSubscriptionError) throw cause;
    throw binaryMismatch('Subscription binary inspection failed.', cause);
  } finally {
    await handle?.close();
  }
}

export interface CreateCodexExecutionProfileOptions {
  readonly binary: CodexBinaryIdentity;
  readonly authHome: CodexAuthHomeIdentity;
  readonly policyDigest: string;
}

export function createCodexExecutionProfile(
  options: CreateCodexExecutionProfileOptions
): CodexExecutionProfile {
  if (
    options.policyDigest !== CODEX_SUBSCRIPTION_MANIFEST.policyDigest ||
    options.binary.path !== CODEX_SUBSCRIPTION_MANIFEST.binaryPath ||
    options.authHome.path !== CODEX_SUBSCRIPTION_MANIFEST.authHomePath
  ) {
    throw new CodexSubscriptionError(
      'Codex execution profile identity does not match the manifest.',
      'profile_mismatch',
      false
    );
  }
  return Object.freeze({
    adapter: 'codex',
    profileId: CODEX_SUBSCRIPTION_MANIFEST.profileId,
    activation: CODEX_SUBSCRIPTION_MANIFEST.activation,
    modelId: CODEX_SUBSCRIPTION_MANIFEST.modelId,
    fixedClientArguments: CODEX_SUBSCRIPTION_MANIFEST.fixedClientArguments,
    environment: CODEX_SUBSCRIPTION_MANIFEST.environment,
    binary: Object.freeze({ ...options.binary }),
    authHome: Object.freeze({ ...options.authHome }),
    sandbox: Object.freeze({
      adapter: 'codex',
      profileId: CODEX_SUBSCRIPTION_MANIFEST.profileId,
      unitTemplate: CODEX_SUBSCRIPTION_MANIFEST.unitTemplate,
      invocationRoot: CODEX_SUBSCRIPTION_MANIFEST.invocationRoot,
      policyDigest: options.policyDigest
    })
  });
}

export interface CreateGrokExecutionProfileOptions {
  readonly binary: GrokBinaryIdentity;
  readonly authHome: GrokAuthHomeIdentity;
  readonly policyDigest: string;
}

export function createGrokExecutionProfile(
  options: CreateGrokExecutionProfileOptions
): GrokExecutionProfile {
  void options;
  throw new GrokSetupRequiredError(
    'Grok Setup Required: no production client and model identity has been accepted.'
  );
}
