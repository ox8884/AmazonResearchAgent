import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { SubscriptionAdapter } from '@ara/shared';

const COMMON_ARTIFACTS = [
  'ops/subscription-providers/manage-invocation.sh',
  'ops/subscription-providers/subscription-supervisor.mjs',
  'ops/systemd/amazon-research-subscription-gc.service',
  'ops/systemd/amazon-research-subscription-gc.timer',
  'ops/polkit/50-amazon-research-subscription.rules',
  'ops/nftables/amazon-research-subscription.nft'
] as const;
const SHA256 = /^[0-9a-f]{64}$/u;
const NETWORK_VALUE = /^[0-9a-f:.]+(?:\/[0-9]{1,3})?$/u;

const InstalledArtifactSchema = z.object({
  path: z.string().startsWith('/').max(500),
  ownerUid: z.number().int().nonnegative(),
  ownerGid: z.number().int().nonnegative(),
  mode: z.number().int().nonnegative().max(0o7777),
  sha256: z.string().regex(SHA256)
}).strict();
const HostSecurityProfileEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  adapter: z.enum(['codex', 'grok']),
  installedArtifacts: z.array(InstalledArtifactSchema).min(1),
  identity: z.object({
    adapterUid: z.number().int().nonnegative(),
    adapterGid: z.number().int().nonnegative(),
    ipcGid: z.number().int().nonnegative(),
    ipcMembers: z.array(z.string().min(1).max(100)).min(1),
    workerUid: z.number().int().nonnegative()
  }).strict(),
  authHome: z.object({
    adapter: z.enum(['codex', 'grok']),
    path: z.string().startsWith('/').max(500),
    ownerUid: z.number().int().nonnegative(),
    ownerGid: z.number().int().nonnegative(),
    mode: z.number().int().nonnegative().max(0o7777)
  }).strict(),
  executable: InstalledArtifactSchema.extend({
    version: z.string().min(1).max(200),
    profileId: z.string().min(1).max(200),
    modelId: z.string().min(1).max(200)
  }).strict(),
  hostCapabilities: z.object({
    systemdVersion: z.string().min(1).max(100),
    unifiedCgroupV2: z.boolean(),
    polkitProfile: z.string().min(1).max(200),
    nftablesProfile: z.string().min(1).max(200),
    containmentProfile: z.string().min(1).max(200)
  }).strict(),
  network: z.object({
    schemaVersion: z.literal(1),
    acceptedHostnames: z.array(z.string().min(1).max(253)).min(1),
    resolverAddresses: z.array(z.string().regex(NETWORK_VALUE)).min(1),
    ipv4Prefixes: z.array(z.string().regex(NETWORK_VALUE)).min(1),
    ipv6Prefixes: z.array(z.string().regex(NETWORK_VALUE)).min(1)
  }).strict()
}).strict();

export type HostSecurityProfileEvidence = z.infer<typeof HostSecurityProfileEvidenceSchema>;

export interface SubscriptionSandboxPolicyArtifact {
  readonly path: string;
  readonly content: string;
}

export interface SubscriptionSandboxArtifactIdentity {
  readonly adapter: SubscriptionAdapter;
  readonly artifactDigest: string;
  readonly artifacts: readonly SubscriptionSandboxPolicyArtifact[];
}

export interface SubscriptionSandboxPolicyIdentity extends SubscriptionSandboxArtifactIdentity {
  readonly securityProfileDigest: string;
  readonly hostEvidence: HostSecurityProfileEvidence;
}

export function subscriptionSandboxPolicyPaths(
  adapter: SubscriptionAdapter
): readonly string[] {
  return [
    `ops/systemd/amazon-research-${adapter}@.service`,
    ...COMMON_ARTIFACTS
  ];
}

function hashCanonical(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sortedUnique(values: readonly string[], normalize = (value: string) => value): string[] {
  return [...new Set(values.map(normalize))].sort();
}

function canonicalHostEvidence(
  adapter: SubscriptionAdapter,
  evidence: HostSecurityProfileEvidence
): HostSecurityProfileEvidence {
  const parsed = HostSecurityProfileEvidenceSchema.parse(evidence);
  if (parsed.adapter !== adapter || parsed.authHome.adapter !== adapter) {
    throw new TypeError('Host security profile adapter identity does not match.');
  }
  return {
    ...parsed,
    installedArtifacts: [...parsed.installedArtifacts]
      .sort((left, right) => left.path.localeCompare(right.path)),
    identity: {
      ...parsed.identity,
      ipcMembers: sortedUnique(parsed.identity.ipcMembers)
    },
    network: {
      ...parsed.network,
      acceptedHostnames: sortedUnique(
        parsed.network.acceptedHostnames,
        (hostname) => hostname.toLowerCase().replace(/\.$/u, '')
      ),
      resolverAddresses: sortedUnique(parsed.network.resolverAddresses, (value) => value.toLowerCase()),
      ipv4Prefixes: sortedUnique(parsed.network.ipv4Prefixes),
      ipv6Prefixes: sortedUnique(parsed.network.ipv6Prefixes, (value) => value.toLowerCase())
    }
  };
}

export async function loadSubscriptionSandboxArtifacts(
  repositoryRoot: string,
  adapter: SubscriptionAdapter
): Promise<SubscriptionSandboxArtifactIdentity> {
  const artifacts = await Promise.all(
    subscriptionSandboxPolicyPaths(adapter).map(async (path) => ({
      path,
      content: await readFile(join(repositoryRoot, path), 'utf8')
    }))
  );
  return {
    adapter,
    artifactDigest: hashCanonical(artifacts.map((artifact) => ({
      path: artifact.path,
      sha256: createHash('sha256').update(artifact.content).digest('hex')
    }))),
    artifacts
  };
}

export async function loadSubscriptionSandboxPolicy(
  repositoryRoot: string,
  adapter: SubscriptionAdapter,
  hostEvidence: HostSecurityProfileEvidence
): Promise<SubscriptionSandboxPolicyIdentity> {
  const artifactIdentity = await loadSubscriptionSandboxArtifacts(repositoryRoot, adapter);
  const canonicalEvidence = canonicalHostEvidence(adapter, hostEvidence);
  return {
    ...artifactIdentity,
    securityProfileDigest: hashCanonical({
      schemaVersion: 1,
      adapter,
      artifactDigest: artifactIdentity.artifactDigest,
      hostEvidence: canonicalEvidence
    }),
    hostEvidence: canonicalEvidence
  };
}
