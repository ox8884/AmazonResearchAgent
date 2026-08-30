import { constants } from 'node:fs';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  CodexSubscriptionError,
  GrokSetupRequiredError,
  GrokSubscriptionError,
  inspectGrokCredentialSource as parseGrokCredentialSource,
  type CodexAuthHomeIdentity,
  type GrokAuthHomeIdentity
} from '@ara/ai-router';

const CREDENTIAL_SOURCE_FILE = 'credential-source.json';
const FORBIDDEN_ENVIRONMENT = [
  'OPENAI_API_KEY',
  'CODEX_ACCESS_TOKEN',
  'OPENAI_BASE_URL',
  'CODEX_PROVIDER'
] as const;
const CredentialSourceSchema = z.object({
  kind: z.literal('chatgpt_subscription'),
  authenticated: z.boolean(),
  endpoint: z.literal('official'),
  providerOverride: z.null()
}).strict();

export interface CodexAuthInspectionOptions {
  readonly expectedUid?: number | undefined;
  readonly expectedGid?: number | undefined;
}

export interface CodexCredentialSource {
  readonly kind: 'chatgpt_subscription';
  readonly authenticated: true;
  readonly endpoint: 'official';
  readonly providerOverride: null;
}

export class CodexAuthorizationRequiredError extends CodexSubscriptionError {
  readonly state = 'authorization_required' as const;

  constructor(message: string, cause?: unknown) {
    super(message, 'auth_expired', false, cause);
    this.name = 'CodexAuthorizationRequiredError';
  }
}

function profileMismatch(message: string, cause?: unknown): CodexSubscriptionError {
  return new CodexSubscriptionError(message, 'profile_mismatch', false, cause);
}

export async function inspectCodexAuthHome(
  path: string,
  options: CodexAuthInspectionOptions
): Promise<CodexAuthHomeIdentity> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw profileMismatch('Codex auth home must be a real directory.');
    }
    if (
      (options.expectedUid !== undefined && info.uid !== options.expectedUid) ||
      (options.expectedGid !== undefined && info.gid !== options.expectedGid) ||
      (process.platform !== 'win32' && (info.mode & 0o7777) !== 0o700)
    ) {
      throw profileMismatch('Codex auth home ownership or mode does not match.');
    }
    if (await realpath(path) !== path) {
      throw profileMismatch('Codex auth home canonical path does not match.');
    }
    return {
      path,
      ownerUid: info.uid,
      ownerGid: info.gid,
      mode: info.mode & 0o7777
    };
  } catch (cause) {
    if (cause instanceof CodexSubscriptionError) throw cause;
    throw profileMismatch('Codex auth home inspection failed.', cause);
  }
}

function rejectForbiddenEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): void {
  for (const name of FORBIDDEN_ENVIRONMENT) {
    if (environment[name] !== undefined) {
      throw new CodexSubscriptionError(
        'Codex effective credential source is not subscription-only.',
        'credential_source_mismatch',
        false
      );
    }
  }
}

export async function inspectCodexCredentialSource(
  authHomePath: string,
  environment: Readonly<Record<string, string | undefined>>
): Promise<CodexCredentialSource> {
  rejectForbiddenEnvironment(environment);
  const path = join(authHomePath, CREDENTIAL_SOURCE_FILE);
  let handle: FileHandle;
  try {
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new CodexAuthorizationRequiredError(
        'Codex subscription authorization evidence is unavailable.'
      );
    }
    handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
    );
  } catch (cause) {
    if (cause instanceof CodexAuthorizationRequiredError) throw cause;
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') {
      throw new CodexAuthorizationRequiredError(
        'Codex subscription authorization is required.',
        cause
      );
    }
    throw new CodexAuthorizationRequiredError(
      'Codex subscription authorization evidence cannot be inspected.',
      cause
    );
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 16 * 1024) {
      throw new CodexAuthorizationRequiredError(
        'Codex subscription authorization evidence is invalid.'
      );
    }
    const parsed = CredentialSourceSchema.safeParse(
      JSON.parse((await handle.readFile()).toString('utf8')) as unknown
    );
    if (!parsed.success || !parsed.data.authenticated) {
      throw new CodexAuthorizationRequiredError(
        'Codex subscription authorization is required.',
        parsed.success ? undefined : parsed.error
      );
    }
    return {
      kind: parsed.data.kind,
      authenticated: true,
      endpoint: parsed.data.endpoint,
      providerOverride: parsed.data.providerOverride
    };
  } catch (cause) {
    if (cause instanceof CodexSubscriptionError) throw cause;
    throw new CodexAuthorizationRequiredError(
      'Codex subscription authorization evidence is invalid.',
      cause
    );
  } finally {
    await handle.close();
  }
}

const GROK_FORBIDDEN_ENVIRONMENT = [
  'XAI_API_KEY',
  'XAI_BASE_URL',
  'GROK_ACCESS_TOKEN',
  'GROK_PROVIDER'
] as const;

export async function inspectGrokAuthHome(
  path: string,
  options: CodexAuthInspectionOptions
): Promise<GrokAuthHomeIdentity> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new GrokSetupRequiredError('Grok auth home must be a real directory.');
    }
    if (
      (options.expectedUid !== undefined && info.uid !== options.expectedUid) ||
      (options.expectedGid !== undefined && info.gid !== options.expectedGid) ||
      (process.platform !== 'win32' && (info.mode & 0o7777) !== 0o700) ||
      await realpath(path) !== path
    ) {
      throw new GrokSetupRequiredError('Grok auth home identity does not match.');
    }
    return { path, ownerUid: info.uid, ownerGid: info.gid, mode: info.mode & 0o7777 };
  } catch (cause) {
    if (cause instanceof GrokSubscriptionError) throw cause;
    throw new GrokSetupRequiredError('Grok auth home inspection failed.');
  }
}

export async function inspectGrokCredentialSource(
  authHomePath: string,
  environment: Readonly<Record<string, string | undefined>>
): Promise<ReturnType<typeof parseGrokCredentialSource>> {
  if (GROK_FORBIDDEN_ENVIRONMENT.some((name) => environment[name] !== undefined)) {
    throw new GrokSubscriptionError(
      'Grok effective credential source is not OAuth-only.',
      'credential_source_mismatch',
      false
    );
  }
  const path = join(authHomePath, CREDENTIAL_SOURCE_FILE);
  let handle: FileHandle;
  try {
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink()) throw new GrokSetupRequiredError();
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (cause) {
    if (cause instanceof GrokSubscriptionError) throw cause;
    throw new GrokSetupRequiredError('Grok OAuth authorization is required.');
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 16 * 1024) throw new GrokSetupRequiredError();
    let evidence: unknown;
    try {
      evidence = JSON.parse((await handle.readFile()).toString('utf8'));
    } catch {
      throw new GrokSetupRequiredError('Grok OAuth evidence is invalid.');
    }
    return parseGrokCredentialSource(evidence, environment);
  } finally {
    await handle.close();
  }
}
