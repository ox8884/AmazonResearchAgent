import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  createCodexExecutionProfile,
  inspectSubscriptionBinary,
  CODEX_SUBSCRIPTION_MANIFEST
} from './subscription-profiles';
import { loadSubscriptionSandboxPolicy } from './subscription-sandbox-policy';

const roots: string[] = [];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

async function binaryFixture(): Promise<string> {
  const root = join(tmpdir(), `ara-codex-binary-${randomUUID()}`);
  const path = join(root, 'codex-client');
  roots.push(root);
  await mkdir(root, { recursive: true });
  await writeFile(path, '#!/bin/sh\nexit 0\n', { mode: 0o500 });
  await chmod(path, 0o500);
  return path;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Codex subscription execution profile', () => {
  // Break: committed Codex profile is enabled before Oracle acceptance.
  it('is disabled with fixed identity and exact sandbox policy digest', () => {
    expect(CODEX_SUBSCRIPTION_MANIFEST).toMatchObject({
      adapter: 'codex',
      activation: 'disabled',
      profileId: 'codex-subscription-v1',
      modelId: 'gpt-5.6',
      unitTemplate: 'amazon-research-codex@.service'
    });
    expect(CODEX_SUBSCRIPTION_MANIFEST.policyDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.isFrozen(CODEX_SUBSCRIPTION_MANIFEST)).toBe(true);
  });

  // Break: profile digest no longer identifies the committed Task-5 artifacts.
  it('pins the current Codex sandbox artifact digest', async () => {
    const policy = await loadSubscriptionSandboxPolicy(repositoryRoot, 'codex');
    expect(policy.digest).toBe(CODEX_SUBSCRIPTION_MANIFEST.policyDigest);
  });

  // Break: binary identity checks accept wrong owner mode version or digest.
  it('rejects every binary identity mismatch', async () => {
    const path = await binaryFixture();
    const info = await inspectSubscriptionBinary(path, {
      expectedUid: process.getuid?.(),
      expectedGid: process.getgid?.(),
      expectedMode: 0o500,
      expectedVersion: 'fixture-v1',
      expectedSha256: undefined,
      readVersion: async () => 'fixture-v1'
    });
    expect(info.sha256).toMatch(/^[0-9a-f]{64}$/u);

    const mismatches = [
      { expectedUid: (process.getuid?.() ?? 0) + 1 },
      { expectedGid: (process.getgid?.() ?? 0) + 1 },
      ...(process.platform === 'win32' ? [] : [{ expectedMode: 0o700 }]),
      { expectedVersion: 'wrong' },
      { expectedSha256: '0'.repeat(64) }
    ];
    for (const mismatch of mismatches) {
      await expect(inspectSubscriptionBinary(path, {
        expectedUid: process.getuid?.(),
        expectedGid: process.getgid?.(),
        expectedMode: 0o500,
        expectedVersion: 'fixture-v1',
        expectedSha256: info.sha256,
        readVersion: async () => 'fixture-v1',
        ...mismatch
      })).rejects.toMatchObject({ failureClass: 'binary_identity_mismatch' });
    }
  });

  // Break: construction accepts a binary or sandbox digest not in the manifest.
  it('creates a profile only from exact inspected identities', async () => {
    const path = await binaryFixture();
    const binary = await inspectSubscriptionBinary(path, {
      expectedUid: process.getuid?.(),
      expectedGid: process.getgid?.(),
      expectedMode: 0o500,
      expectedVersion: 'fixture-v1',
      expectedSha256: undefined,
      readVersion: async () => 'fixture-v1'
    });
    const fixedBinary = {
      ...binary,
      path: CODEX_SUBSCRIPTION_MANIFEST.binaryPath
    };
    const profile = createCodexExecutionProfile({
      binary: fixedBinary,
      authHome: {
        path: '/var/lib/amazon-research/subscription/codex',
        ownerUid: 501,
        ownerGid: 501,
        mode: 0o700
      },
      policyDigest: CODEX_SUBSCRIPTION_MANIFEST.policyDigest
    });
    expect(profile.environment).toEqual({});
    expect(profile.fixedClientArguments).toEqual([
      '--fixed-profile',
      'codex-subscription-v1'
    ]);
    expect(() => createCodexExecutionProfile({
      binary: fixedBinary,
      authHome: profile.authHome,
      policyDigest: '0'.repeat(64)
    })).toThrow();
    expect(() => createCodexExecutionProfile({
      binary,
      authHome: profile.authHome,
      policyDigest: CODEX_SUBSCRIPTION_MANIFEST.policyDigest
    })).toThrow();
  });
});
