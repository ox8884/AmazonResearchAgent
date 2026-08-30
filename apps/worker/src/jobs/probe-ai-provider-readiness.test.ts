import { describe, expect, it, vi } from 'vitest';
import { AdapterSemaphoreRegistry } from '../providers/adapter-semaphore';
import {
  ProbeBindingMismatchError,
  runProviderAcceptanceProbe,
  runProviderReadinessProbe,
  type ProviderProbeInspector,
  type ProviderProbeTarget
} from './probe-ai-provider-readiness';

const bindings = {
  providerId: 'provider-a',
  expectedSettingsRevision: 4,
  expectedAuthGeneration: 2,
  expectedExecutionFingerprint: 'fingerprint-a'
};

function target(overrides: Partial<ProviderProbeTarget> = {}): ProviderProbeTarget {
  return {
    ...bindings,
    adapter: 'codex',
    modelId: 'gpt-5.6',
    enabled: true,
    clientAccepted: true,
    ...overrides
  };
}

function repository() {
  return {
    commitAcceptanceProbe: vi.fn(async () => ({ accepted: true })),
    commitProbe: vi.fn(async () => ({ ready: true }))
  };
}

function inspector(overrides: Partial<ProviderProbeInspector> = {}): ProviderProbeInspector {
  return {
    async inspect() {
      return {
        securityProfileDigest: '0'.repeat(64),
        termsDigest: '1'.repeat(64),
        credentialSourceDigest: '2'.repeat(64),
        binaryIdentityDigest: '3'.repeat(64),
        capabilityDigest: '4'.repeat(64),
        framingDigest: '5'.repeat(64),
        boundedBehaviorDigest: '6'.repeat(64)
      };
    },
    containment: {
      async attempt() {
        return true;
      }
    },
    ...overrides
  };
}

const payload = {
  providerId: 'provider-a',
  settingsRevision: 4,
  authGeneration: 2,
  executionFingerprint: 'fingerprint-a',
  probeGeneration: 9
};

describe('subscription readiness orchestration', () => {
  // Break: disabled Stage-A acceptance can issue Ready or skip immutable evidence.
  it('persists disabled acceptance evidence without committing Ready', async () => {
    const runtime = repository();
    const result = await runProviderAcceptanceProbe({
      target: target({ enabled: false }),
      inspector: inspector(),
      runtime,
      semaphores: new AdapterSemaphoreRegistry(),
      signal: new AbortController().signal
    });
    expect(result).toMatchObject({ mode: 'acceptance', accepted: true });
    expect(runtime.commitAcceptanceProbe).toHaveBeenCalledOnce();
    expect(runtime.commitProbe).not.toHaveBeenCalled();
    expect(runtime.commitAcceptanceProbe).toHaveBeenCalledWith(expect.objectContaining({
      ...bindings,
      adapter: 'codex',
      modelId: 'gpt-5.6',
      securityProfileDigest: '0'.repeat(64),
      containmentDigest: expect.stringMatching(/^[0-9a-f]{64}$/u)
    }));
  });

  // Break: a full probe can Ready a disabled or unaccepted provider.
  it.each([
    { enabled: false },
    { clientAccepted: false }
  ])('rejects full readiness for $enabled/$clientAccepted', async (override) => {
    const runtime = repository();
    await expect(runProviderReadinessProbe({
      payload,
      target: target(override),
      inspector: inspector(),
      runtime,
      semaphores: new AdapterSemaphoreRegistry(),
      signal: new AbortController().signal
    })).rejects.toMatchObject({ state: 'setup_required' });
    expect(runtime.commitProbe).not.toHaveBeenCalled();
  });

  // Break: stale settings/auth/fingerprint/generation payload reaches inspection or commit.
  it.each([
    { settingsRevision: 5 },
    { authGeneration: 3 },
    { executionFingerprint: 'stale' },
    { probeGeneration: 10 }
  ])('rejects stale binding %# before inspection', async (stale) => {
    const runtime = repository();
    const inspect = vi.fn(inspector().inspect);
    await expect(runProviderReadinessProbe({
      payload: { ...payload, ...stale },
      target: target(),
      currentProbeGeneration: 9,
      inspector: { ...inspector(), inspect },
      runtime,
      semaphores: new AdapterSemaphoreRegistry(),
      signal: new AbortController().signal
    })).rejects.toBeInstanceOf(ProbeBindingMismatchError);
    expect(inspect).not.toHaveBeenCalled();
    expect(runtime.commitProbe).not.toHaveBeenCalled();
  });

  // Break: full readiness commits before all inspections and hostile denials pass.
  it('commits only the current generation after complete evidence', async () => {
    const runtime = repository();
    const result = await runProviderReadinessProbe({
      payload,
      target: target(),
      currentProbeGeneration: 9,
      inspector: inspector(),
      runtime,
      semaphores: new AdapterSemaphoreRegistry(),
      signal: new AbortController().signal
    });
    expect(result).toMatchObject({ mode: 'readiness', ready: true });
    expect(runtime.commitProbe).toHaveBeenCalledWith({
      ...bindings,
      modelId: 'gpt-5.6',
      expectedProbeGeneration: 9,
      securityProfileDigest: '0'.repeat(64),
      termsDigest: '1'.repeat(64),
      credentialSourceDigest: '2'.repeat(64),
      binaryIdentityDigest: '3'.repeat(64),
      capabilityDigest: '4'.repeat(64),
      framingDigest: '5'.repeat(64),
      boundedBehaviorDigest: '6'.repeat(64),
      containmentDigest: expect.stringMatching(/^[0-9a-f]{64}$/u)
    });
  });

  // Break: a successfully Ready provider leaves Waiting normalization dormant.
  it('rearms Waiting normalization only after readiness commits', async () => {
    const onReady = vi.fn(async () => undefined);
    await runProviderReadinessProbe({
      payload,
      target: target(),
      currentProbeGeneration: 9,
      inspector: inspector(),
      runtime: repository(),
      semaphores: new AdapterSemaphoreRegistry(),
      signal: new AbortController().signal,
      onReady
    });
    expect(onReady).toHaveBeenCalledOnce();
  });

  // Break: one hostile probe failure or cancellation still persists evidence/Ready.
  it('does not commit after containment failure or cancellation', async () => {
    const cases = [
      {
        probeInspector: inspector({
          containment: {
            async attempt(category) {
              return category !== 'external_write';
            }
          }
        }),
        aborted: false
      },
      { probeInspector: inspector(), aborted: true }
    ];
    for (const item of cases) {
      const runtime = repository();
      const controller = new AbortController();
      if (item.aborted) {
        controller.abort(new DOMException('cancelled', 'AbortError'));
      }
      await expect(runProviderReadinessProbe({
        payload,
        target: target(),
        currentProbeGeneration: 9,
        inspector: item.probeInspector,
        runtime,
        semaphores: new AdapterSemaphoreRegistry(),
        signal: controller.signal
      })).rejects.toThrow();
      expect(runtime.commitProbe).not.toHaveBeenCalled();
    }
  });

  // Break: malformed inspector evidence is persisted as an immutable attestation.
  it('rejects malformed evidence before containment or commit', async () => {
    const runtime = repository();
    const attempt = vi.fn(async () => true);
    await expect(runProviderAcceptanceProbe({
      target: target({ enabled: false }),
      inspector: inspector({
        async inspect() {
          return {
            securityProfileDigest: '0'.repeat(64),
            termsDigest: 'not-a-digest',
            credentialSourceDigest: '2'.repeat(64),
            binaryIdentityDigest: '3'.repeat(64),
            capabilityDigest: '4'.repeat(64),
            framingDigest: '5'.repeat(64),
            boundedBehaviorDigest: '6'.repeat(64)
          };
        },
        containment: { attempt }
      }),
      runtime,
      semaphores: new AdapterSemaphoreRegistry(),
      signal: new AbortController().signal
    })).rejects.toThrow('SHA-256 digests');
    expect(attempt).not.toHaveBeenCalled();
    expect(runtime.commitAcceptanceProbe).not.toHaveBeenCalled();
    expect(runtime.commitProbe).not.toHaveBeenCalled();
  });
});
