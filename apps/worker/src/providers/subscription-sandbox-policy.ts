import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SubscriptionAdapter } from '@ara/shared';

const COMMON_ARTIFACTS = [
  'ops/subscription-providers/manage-invocation.sh',
  'ops/subscription-providers/subscription-supervisor.mjs',
  'ops/systemd/amazon-research-subscription-gc.service',
  'ops/systemd/amazon-research-subscription-gc.timer',
  'ops/polkit/50-amazon-research-subscription.rules',
  'ops/nftables/amazon-research-subscription.nft'
] as const;

export interface SubscriptionSandboxPolicyArtifact {
  readonly path: string;
  readonly content: string;
}

export interface SubscriptionSandboxPolicyIdentity {
  readonly adapter: SubscriptionAdapter;
  readonly digest: string;
  readonly artifacts: readonly SubscriptionSandboxPolicyArtifact[];
}

export function subscriptionSandboxPolicyPaths(
  adapter: SubscriptionAdapter
): readonly string[] {
  return [
    `ops/systemd/amazon-research-${adapter}@.service`,
    ...COMMON_ARTIFACTS
  ];
}

export async function loadSubscriptionSandboxPolicy(
  repositoryRoot: string,
  adapter: SubscriptionAdapter
): Promise<SubscriptionSandboxPolicyIdentity> {
  const artifacts = await Promise.all(
    subscriptionSandboxPolicyPaths(adapter).map(async (path) => ({
      path,
      content: await readFile(join(repositoryRoot, path), 'utf8')
    }))
  );
  const hash = createHash('sha256');
  for (const artifact of artifacts) {
    hash.update(artifact.path, 'utf8');
    hash.update('\0', 'utf8');
    hash.update(artifact.content, 'utf8');
    hash.update('\0', 'utf8');
  }
  return {
    adapter,
    digest: hash.digest('hex'),
    artifacts
  };
}
