import { createHash } from 'node:crypto';

export const HOSTILE_CONTAINMENT_CATEGORIES = Object.freeze([
  'production_source_read',
  'worker_environment_read',
  'unrelated_home_read',
  'ssh_material_read',
  'hermes_read',
  'external_write',
  'subprocess_execution',
  'shell_execution',
  'arbitrary_network',
  'mcp_access',
  'hooks_access',
  'rules_config_access',
  'session_memory_access',
  'subagent_access',
  'provider_override',
  'artifact_persistence',
  'cross_invocation_observation'
] as const);

export type HostileContainmentCategory =
  (typeof HOSTILE_CONTAINMENT_CATEGORIES)[number];

export interface ContainmentAttemptResult {
  readonly category: HostileContainmentCategory;
  readonly denied: boolean;
}

export interface ContainmentProbeRunner {
  attempt(category: HostileContainmentCategory, signal: AbortSignal): Promise<boolean>;
}

export interface ContainmentEvidence {
  readonly digest: string;
  readonly deniedCategories: readonly HostileContainmentCategory[];
}

export class ContainmentProbeError extends Error {
  constructor(readonly category: HostileContainmentCategory) {
    super(`Containment denial was not proven for ${category}.`);
    this.name = 'ContainmentProbeError';
  }
}

export async function runContainmentProbe(
  runner: ContainmentProbeRunner,
  signal: AbortSignal
): Promise<ContainmentEvidence> {
  const denied: HostileContainmentCategory[] = [];
  for (const category of HOSTILE_CONTAINMENT_CATEGORIES) {
    signal.throwIfAborted();
    if (!await runner.attempt(category, signal)) {
      throw new ContainmentProbeError(category);
    }
    denied.push(category);
  }
  const digest = createHash('sha256')
    .update(denied.join('\0'), 'utf8')
    .digest('hex');
  return Object.freeze({
    digest,
    deniedCategories: Object.freeze(denied)
  });
}
