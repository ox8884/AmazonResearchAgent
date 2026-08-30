import {
  READINESS_POLICY_VERSION,
  SECURITY_PROFILE_VERSION,
  type Json,
  type ProviderRuntimeRepository
} from '@ara/db';
import type {
  ProbeAiProviderReadinessPayload
} from '@ara/queue';
import type { SubscriptionAdapter } from '@ara/shared';
import type { AdapterSemaphoreRegistry } from '../providers/adapter-semaphore';
import {
  runContainmentProbe,
  type ContainmentProbeRunner
} from '../providers/containment-probe';

export interface ProviderProbeTarget {
  readonly providerId: string;
  readonly adapter: SubscriptionAdapter;
  readonly modelId: string;
  readonly enabled: boolean;
  readonly clientAccepted: boolean;
  readonly expectedSettingsRevision: number;
  readonly expectedAuthGeneration: number;
  readonly expectedExecutionFingerprint: string;
}

export interface ProviderInspectionEvidence {
  readonly termsDigest: string;
  readonly credentialSourceDigest: string;
  readonly binaryIdentityDigest: string;
  readonly capabilityDigest: string;
  readonly framingDigest: string;
  readonly boundedBehaviorDigest: string;
}

export interface ProviderProbeInspector {
  inspect(signal: AbortSignal): Promise<ProviderInspectionEvidence>;
  readonly containment: ContainmentProbeRunner;
}

interface ProbeDependencies {
  readonly target: ProviderProbeTarget;
  readonly inspector: ProviderProbeInspector;
  readonly runtime: Pick<
    ProviderRuntimeRepository,
    'commitAcceptanceProbe' | 'commitProbe'
  >;
  readonly semaphores: AdapterSemaphoreRegistry;
  readonly signal: AbortSignal;
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

function validateInspectionEvidence(
  evidence: ProviderInspectionEvidence
): ProviderInspectionEvidence {
  for (const digest of Object.values(evidence)) {
    if (!DIGEST_PATTERN.test(digest)) {
      throw new TypeError('Provider inspection evidence must contain SHA-256 digests.');
    }
  }
  return evidence;
}

export class ProbeBindingMismatchError extends Error {
  constructor() {
    super('Provider readiness probe bindings are stale.');
    this.name = 'ProbeBindingMismatchError';
  }
}

export class ProviderSetupRequiredError extends Error {
  readonly state = 'setup_required' as const;

  constructor() {
    super('Provider setup and independent acceptance are required.');
    this.name = 'ProviderSetupRequiredError';
  }
}

function resultObject(value: Json): Record<string, Json | undefined> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Provider runtime result must be a JSON object.');
  }
  return value;
}

async function collectEvidence(
  dependencies: ProbeDependencies
): Promise<{
  readonly inspection: ProviderInspectionEvidence;
  readonly containmentDigest: string;
  readonly evidence: Json;
}> {
  return dependencies.semaphores.withPermit(
    dependencies.target.adapter,
    dependencies.signal,
    async () => {
      dependencies.signal.throwIfAborted();
      const inspection = validateInspectionEvidence(
        await dependencies.inspector.inspect(dependencies.signal)
      );
      dependencies.signal.throwIfAborted();
      const containment = await runContainmentProbe(
        dependencies.inspector.containment,
        dependencies.signal
      );
      return {
        inspection,
        containmentDigest: containment.digest,
        evidence: {
          version: 1,
          deniedCategories: [...containment.deniedCategories]
        }
      };
    }
  );
}

function bindingInput(target: ProviderProbeTarget) {
  return {
    providerId: target.providerId,
    expectedSettingsRevision: target.expectedSettingsRevision,
    expectedAuthGeneration: target.expectedAuthGeneration,
    expectedExecutionFingerprint: target.expectedExecutionFingerprint
  };
}

export async function runProviderAcceptanceProbe(
  dependencies: ProbeDependencies
): Promise<Record<string, Json | undefined>> {
  if (dependencies.target.enabled || !dependencies.target.clientAccepted) {
    throw new ProviderSetupRequiredError();
  }
  const { inspection, containmentDigest, evidence } = await collectEvidence(dependencies);
  dependencies.signal.throwIfAborted();
  const committed = await dependencies.runtime.commitAcceptanceProbe({
    ...bindingInput(dependencies.target),
    modelId: dependencies.target.modelId,
    adapter: dependencies.target.adapter,
    securityProfileVersion: SECURITY_PROFILE_VERSION,
    readinessPolicyVersion: READINESS_POLICY_VERSION,
    termsDigest: inspection.termsDigest,
    credentialSourceDigest: inspection.credentialSourceDigest,
    binaryIdentityDigest: inspection.binaryIdentityDigest,
    capabilityDigest: inspection.capabilityDigest,
    framingDigest: inspection.framingDigest,
    boundedBehaviorDigest: inspection.boundedBehaviorDigest,
    containmentDigest,
    evidence
  });
  return { mode: 'acceptance', ...resultObject(committed) };
}

function assertCurrentBindings(
  payload: ProbeAiProviderReadinessPayload,
  target: ProviderProbeTarget,
  currentProbeGeneration: number
): void {
  if (
    payload.providerId !== target.providerId ||
    payload.settingsRevision !== target.expectedSettingsRevision ||
    payload.authGeneration !== target.expectedAuthGeneration ||
    payload.executionFingerprint !== target.expectedExecutionFingerprint ||
    payload.probeGeneration !== currentProbeGeneration
  ) {
    throw new ProbeBindingMismatchError();
  }
}

export async function runProviderReadinessProbe(
  dependencies: ProbeDependencies & {
    readonly payload: ProbeAiProviderReadinessPayload;
    readonly currentProbeGeneration?: number;
  }
): Promise<Record<string, Json | undefined>> {
  if (!dependencies.target.enabled || !dependencies.target.clientAccepted) {
    throw new ProviderSetupRequiredError();
  }
  if (dependencies.currentProbeGeneration === undefined) {
    throw new ProbeBindingMismatchError();
  }
  assertCurrentBindings(
    dependencies.payload,
    dependencies.target,
    dependencies.currentProbeGeneration
  );
  await collectEvidence(dependencies);
  dependencies.signal.throwIfAborted();
  const committed = await dependencies.runtime.commitProbe({
    ...bindingInput(dependencies.target),
    modelId: dependencies.target.modelId,
    expectedProbeGeneration: dependencies.payload.probeGeneration
  });
  return { mode: 'readiness', ...resultObject(committed) };
}
