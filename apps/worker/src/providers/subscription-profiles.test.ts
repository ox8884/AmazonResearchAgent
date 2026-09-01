import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  CODEX_SUBSCRIPTION_MANIFEST,
  GROK_SUBSCRIPTION_MANIFEST,
  createCodexExecutionProfile,
  createGrokExecutionProfile,
  inspectSubscriptionBinary
} from './subscription-profiles';
import {
  loadSubscriptionSandboxArtifacts,
  loadSubscriptionSandboxPolicy,
  type HostSecurityProfileEvidence
} from './subscription-sandbox-policy';

const roots: string[] = [];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function hostEvidence(
  overrides: Partial<HostSecurityProfileEvidence> = {}
): HostSecurityProfileEvidence {
  return {
    schemaVersion: 1,
    adapter: 'codex',
    installedArtifacts: [{
      path: '/usr/local/libexec/amazon-research/subscription-supervisor.mjs',
      ownerUid: 0,
      ownerGid: 0,
      mode: 0o500,
      sha256: '1'.repeat(64)
    }],
    identity: {
      adapterUid: 501,
      adapterGid: 501,
      ipcGid: 601,
      ipcMembers: ['amazon-research', 'ara-codex'],
      workerUid: 500
    },
    authHome: {
      adapter: 'codex',
      path: '/var/lib/amazon-research/subscription/codex',
      ownerUid: 501,
      ownerGid: 501,
      mode: 0o700
    },
    executable: {
      path: '/usr/local/libexec/amazon-research/codex-subscription-client',
      ownerUid: 501,
      ownerGid: 501,
      mode: 0o500,
      version: '1.0.0',
      sha256: '2'.repeat(64),
      profileId: 'codex-subscription-v1',
      modelId: 'gpt-5.6'
    },
    hostCapabilities: {
      systemdVersion: '255',
      unifiedCgroupV2: true,
      polkitProfile: 'subscription-polkit-v1',
      nftablesProfile: 'subscription-nftables-v1',
      containmentProfile: 'subscription-containment-v1'
    },
    network: {
      schemaVersion: 1,
      acceptedHostnames: ['api.example.com'],
      resolverAddresses: ['1.1.1.1'],
      ipv4Prefixes: ['203.0.113.0/24'],
      ipv6Prefixes: ['2001:db8::/32']
    },
    ...overrides
  };
}

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

  // Break: failed Gate 1 evidence is represented as a production terms attestation.
  it('keeps Codex disabled without approved terms evidence', () => {
    expect(CODEX_SUBSCRIPTION_MANIFEST).not.toHaveProperty('approvedTermsEvidence');
    expect(CODEX_SUBSCRIPTION_MANIFEST.activation).toBe('disabled');
  });

  // Break: profile digest no longer identifies the committed Task-5 artifacts.
  it('pins the current Codex sandbox artifact digest', async () => {
    const policy = await loadSubscriptionSandboxArtifacts(repositoryRoot, 'codex');
    expect(policy.artifactDigest).toBe(CODEX_SUBSCRIPTION_MANIFEST.policyDigest);
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

describe('Grok subscription execution profile', () => {
  // Break: guessed or Codex-derived client evidence makes Grok production-routable.
  it('remains independently setup-required without an accepted client identity', () => {
    expect(GROK_SUBSCRIPTION_MANIFEST).toMatchObject({
      adapter: 'grok',
      activation: 'disabled',
      clientAcceptance: 'setup_required',
      modelId: null,
      profileId: 'grok-subscription-v1',
      unitTemplate: 'amazon-research-grok@.service',
      invocationRoot: '/run/amazon-research/subscription/grok',
      authHomePath: '/var/lib/amazon-research/subscription/grok',
      binaryPath: '/usr/local/libexec/amazon-research/grok-subscription-client'
    });
    expect(() => createGrokExecutionProfile({
      binary: {
        path: '/usr/local/libexec/amazon-research/grok-subscription-client',
        ownerUid: 501,
        ownerGid: 501,
        mode: 0o500,
        version: 'codex-evidence-must-not-activate-grok',
        sha256: 'a'.repeat(64)
      },
      authHome: {
        path: '/var/lib/amazon-research/subscription/codex',
        ownerUid: 501,
        ownerGid: 501,
        mode: 0o700
      },
      policyDigest: CODEX_SUBSCRIPTION_MANIFEST.policyDigest
    })).toThrowError(/Setup Required/u);
  });

  // Break: Grok silently reuses the Codex sandbox policy attestation.
  it('pins a distinct Grok sandbox artifact digest', async () => {
    const [codex, grok] = await Promise.all([
      loadSubscriptionSandboxArtifacts(repositoryRoot, 'codex'),
      loadSubscriptionSandboxArtifacts(repositoryRoot, 'grok')
    ]);
    expect(grok.artifactDigest).toBe(GROK_SUBSCRIPTION_MANIFEST.policyDigest);
    expect(grok.artifactDigest).not.toBe(codex.artifactDigest);
  });
});

describe('host security profile evidence', () => {
  // Break: material installed, identity, auth, executable, capability, or network drift keeps one digest.
  it('changes the policy digest for every material host-profile drift', async () => {
    const base = hostEvidence();
    const [installedArtifact] = base.installedArtifacts;
    if (installedArtifact === undefined) throw new Error('Host evidence fixture requires one artifact.');
    const accepted = await loadSubscriptionSandboxPolicy(repositoryRoot, 'codex', base);
    const variants = [
      hostEvidence({ installedArtifacts: [{ ...installedArtifact, mode: 0o700 }] }),
      hostEvidence({ installedArtifacts: [{ ...installedArtifact, ownerUid: 9 }] }),
      hostEvidence({ identity: { ...base.identity, ipcMembers: ['ara-codex'] } }),
      hostEvidence({ authHome: { ...base.authHome, mode: 0o750 } }),
      hostEvidence({ executable: { ...base.executable, sha256: '3'.repeat(64) } }),
      hostEvidence({ hostCapabilities: { ...base.hostCapabilities, unifiedCgroupV2: false } }),
      hostEvidence({ network: { ...base.network, acceptedHostnames: ['other.example.com'] } }),
      hostEvidence({ network: { ...base.network, resolverAddresses: ['8.8.8.8'] } }),
      hostEvidence({ network: { ...base.network, ipv4Prefixes: ['198.51.100.0/24'] } }),
      hostEvidence({ network: { ...base.network, ipv6Prefixes: ['2001:db8:1::/48'] } })
    ];
    for (const variant of variants) {
      const changed = await loadSubscriptionSandboxPolicy(repositoryRoot, 'codex', variant);
      expect(changed.securityProfileDigest).not.toBe(accepted.securityProfileDigest);
    }
  });

  // Break: ordering-only differences produce different canonical policy identities.
  it('canonicalizes equivalent sorted host profiles to one digest', async () => {
    const base = hostEvidence({
      network: {
        ...hostEvidence().network,
        acceptedHostnames: ['b.example.com', 'a.example.com'],
        resolverAddresses: ['8.8.8.8', '1.1.1.1']
      }
    });
    const reordered = hostEvidence({
      network: {
        ...base.network,
        acceptedHostnames: [...base.network.acceptedHostnames].reverse(),
        resolverAddresses: [...base.network.resolverAddresses].reverse()
      }
    });
    const first = await loadSubscriptionSandboxPolicy(repositoryRoot, 'codex', base);
    const second = await loadSubscriptionSandboxPolicy(repositoryRoot, 'codex', reordered);
    expect(second.securityProfileDigest).toBe(first.securityProfileDigest);
  });

  // Break: character-only validation accepts malformed addresses, invalid prefix lengths, or the wrong address family.
  it.each([
    ['malformed resolver', { resolverAddresses: [':'] }],
    ['malformed IPv4 address', { ipv4Prefixes: ['999.2.3.4/24'] }],
    ['malformed IPv6 address', { ipv6Prefixes: ['2001:::1/64'] }],
    ['IPv4 prefix above 32', { ipv4Prefixes: ['1.2.3.4/999'] }],
    ['IPv6 prefix above 128', { ipv6Prefixes: ['2001:db8::/129'] }],
    ['IPv4 inside IPv6 prefixes', { ipv6Prefixes: ['1.2.3.4/24'] }],
    ['IPv6 inside IPv4 prefixes', { ipv4Prefixes: ['2001:db8::/32'] }],
    ['IPv4-mapped IPv6 resolver', { resolverAddresses: ['::ffff:192.0.2.1'] }]
  ])('rejects %s', async (_name, networkOverride) => {
    const base = hostEvidence();
    await expect(loadSubscriptionSandboxPolicy(repositoryRoot, 'codex', hostEvidence({
      network: { ...base.network, ...networkOverride }
    }))).rejects.toBeDefined();
  });

  // Break: semantic network equivalents retain host bits or textual spelling and produce different policy identities.
  it('canonicalizes equivalent IPv4 and IPv6 prefixes before sorting and deduplication', async () => {
    const base = hostEvidence();
    const expanded = await loadSubscriptionSandboxPolicy(repositoryRoot, 'codex', hostEvidence({
      network: {
        ...base.network,
        acceptedHostnames: ['API.EXAMPLE.COM.', 'api.example.com'],
        resolverAddresses: ['2001:0db8:0:0:0:0:0:1', '1.1.1.1', '2001:db8::1'],
        ipv4Prefixes: ['203.0.113.7/24', '203.0.113.0/24'],
        ipv6Prefixes: [
          '2001:0db8:0000:0000:0000:0000:0001:00ff/32',
          '2001:db8::/32'
        ]
      }
    }));
    const canonical = await loadSubscriptionSandboxPolicy(repositoryRoot, 'codex', hostEvidence({
      network: {
        ...base.network,
        acceptedHostnames: ['api.example.com'],
        resolverAddresses: ['1.1.1.1', '2001:db8::1'],
        ipv4Prefixes: ['203.0.113.0/24'],
        ipv6Prefixes: ['2001:db8::/32']
      }
    }));
    expect(expanded.hostEvidence.network).toEqual(canonical.hostEvidence.network);
    expect(expanded.securityProfileDigest).toBe(canonical.securityProfileDigest);
  });

  // Break: repeated identical artifacts alter the digest, or conflicting evidence for one installed path is accepted.
  it('deduplicates identical installed artifacts and rejects conflicting path evidence', async () => {
    const base = hostEvidence();
    const artifact = base.installedArtifacts[0];
    if (artifact === undefined) throw new Error('Host evidence fixture requires one artifact.');
    const single = await loadSubscriptionSandboxPolicy(repositoryRoot, 'codex', base);
    const duplicate = await loadSubscriptionSandboxPolicy(repositoryRoot, 'codex', hostEvidence({
      installedArtifacts: [artifact, { ...artifact }]
    }));
    expect(duplicate.hostEvidence.installedArtifacts).toEqual([artifact]);
    expect(duplicate.securityProfileDigest).toBe(single.securityProfileDigest);
    await expect(loadSubscriptionSandboxPolicy(repositoryRoot, 'codex', hostEvidence({
      installedArtifacts: [artifact, { ...artifact, mode: 0o700 }]
    }))).rejects.toBeDefined();
  });
});
