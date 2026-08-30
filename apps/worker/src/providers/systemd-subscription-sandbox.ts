import { join } from 'node:path';
import {
  IPC_LIMITS,
  SubscriptionRequestEnvelopeSchema,
  SubscriptionSandboxError,
  verifyInvocationDirectory,
  writeAtomicIpcJson,
  type SubscriptionProcessTransport,
  type SubscriptionResultEnvelope,
  type SubscriptionSandboxPhase
} from '@ara/ai-router';
import type { SubscriptionAdapter } from '@ara/shared';
import { SubscriptionSandboxLifecycle } from './systemd-subscription-lifecycle';
import type {
  SubscriptionSandboxController
} from './systemd-subscription-controller';

export {
  SystemctlSubscriptionSandboxController
} from './systemd-subscription-controller';
export type {
  SubscriptionSandboxController,
  SubscriptionUnitState
} from './systemd-subscription-controller';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface SubscriptionSandboxProfile {
  readonly adapter: SubscriptionAdapter;
  readonly profileId: string;
  readonly unitTemplate:
    | 'amazon-research-codex@.service'
    | 'amazon-research-grok@.service';
  readonly invocationRoot: string;
  readonly workerUid?: number | undefined;
  readonly adapterUid?: number | undefined;
  readonly ipcGid?: number | undefined;
}

export interface SubscriptionInvocation {
  readonly attemptId: string;
  readonly modelId: string;
  readonly role: 'niche_normalization';
  readonly locale: string;
  readonly prompt: string;
  readonly inputHash: string;
}

export interface SystemdSubscriptionSandboxOptions {
  readonly controller: SubscriptionSandboxController;
  readonly pollIntervalMs?: number;
  readonly requestHandoffTimeoutMs?: number;
  readonly startupTimeoutMs?: number;
  readonly executionTimeoutMs?: number;
  readonly cleanupTimeoutMs?: number;
}

function unitName(profile: SubscriptionSandboxProfile, attemptId: string): string {
  if (!UUID_PATTERN.test(attemptId)) {
    throw new SubscriptionSandboxError(
      'Attempt identity is not a canonical UUID.',
      'start',
      'S0'
    );
  }
  const expectedTemplate = `amazon-research-${profile.adapter}@.service`;
  if (profile.unitTemplate !== expectedTemplate) {
    throw new SubscriptionSandboxError(
      'Adapter and unit template do not match.',
      'start',
      'S0'
    );
  }
  return profile.unitTemplate.replace('@.service', `@${attemptId}.service`);
}

export class SystemdSubscriptionSandbox implements SubscriptionProcessTransport<
  SubscriptionSandboxProfile,
  SubscriptionInvocation,
  SubscriptionResultEnvelope
> {
  readonly isolation = 'systemd-subscription-sandbox-v1' as const;
  private readonly controller: SubscriptionSandboxController;
  private readonly lifecycle: SubscriptionSandboxLifecycle;

  constructor(options: SystemdSubscriptionSandboxOptions) {
    this.controller = options.controller;
    this.lifecycle = new SubscriptionSandboxLifecycle(options.controller, {
      pollIntervalMs: options.pollIntervalMs ?? 50,
      requestHandoffTimeoutMs: options.requestHandoffTimeoutMs ?? 5_000,
      startupTimeoutMs: options.startupTimeoutMs ?? 15_000,
      executionTimeoutMs: options.executionTimeoutMs ?? 120_000,
      cleanupTimeoutMs: options.cleanupTimeoutMs ?? 10_000
    });
  }

  async run(
    profile: SubscriptionSandboxProfile,
    invocation: SubscriptionInvocation,
    signal: AbortSignal
  ): Promise<SubscriptionResultEnvelope> {
    let phase: SubscriptionSandboxPhase = 'S0';
    const name = unitName(profile, invocation.attemptId);
    const path = join(profile.invocationRoot, invocation.attemptId);
    let startRequested = false;
    try {
      this.lifecycle.throwIfAborted(signal, phase);
      phase = 'S1';
      await this.controller.startNoBlock(name);
      startRequested = true;
      await this.lifecycle.waitForDirectory(name, path, signal, phase);
      phase = 'S2';
      const directory = await verifyInvocationDirectory({
        directoryPath: path,
        expectedRoot: profile.invocationRoot,
        instanceId: invocation.attemptId,
        expectedUid: profile.workerUid,
        expectedGid: profile.ipcGid,
        expectedMode: 0o2770
      });
      try {
        this.lifecycle.throwIfAborted(signal, phase);
        await writeAtomicIpcJson({
          directory,
          temporaryName: 'request.tmp',
          finalName: 'request.json',
          value: {
            version: 1,
            adapter: profile.adapter,
            profileId: profile.profileId,
            ...invocation
          },
          schema: SubscriptionRequestEnvelopeSchema,
          maximumBytes: IPC_LIMITS.request,
          mode: 0o640,
          expectedUid: profile.workerUid,
          expectedGid: profile.ipcGid
        });
        phase = 'S3';
        const mainState = await this.lifecycle.waitForMain(name, signal, phase);
        phase = 'S4';
        await this.lifecycle.waitForReady(name, mainState, signal, phase);
        phase = 'S5';
        const result = await this.lifecycle.waitForResult(
          name,
          directory,
          profile,
          invocation,
          signal,
          phase
        );
        await directory.close();
        await this.lifecycle.cleanup(name, path, phase);
        return result;
      } finally {
        await directory.close();
      }
    } catch (error) {
      if (startRequested) await this.lifecycle.cleanup(name, path, phase);
      if (error instanceof SubscriptionSandboxError) throw error;
      if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        throw new SubscriptionSandboxError(
          'Sandbox invocation was cancelled.',
          'cancelled',
          phase,
          error
        );
      }
      throw new SubscriptionSandboxError(
        'Sandbox invocation failed.',
        'ipc',
        phase,
        error
      );
    }
  }
}
