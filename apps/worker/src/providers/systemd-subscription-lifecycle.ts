import { lstat } from 'node:fs/promises';
import {
  IPC_LIMITS,
  SubscriptionResultEnvelopeSchema,
  SubscriptionSandboxError,
  readVerifiedIpcJson,
  type SubscriptionResultEnvelope,
  type SubscriptionSandboxPhase,
  type VerifiedInvocationDirectory
} from '@ara/ai-router';
import type {
  SubscriptionInvocation,
  SubscriptionSandboxProfile
} from './systemd-subscription-sandbox';
import type {
  SubscriptionSandboxController,
  SubscriptionUnitState
} from './systemd-subscription-controller';

export interface SubscriptionSandboxTimeouts {
  readonly pollIntervalMs: number;
  readonly requestHandoffTimeoutMs: number;
  readonly startupTimeoutMs: number;
  readonly executionTimeoutMs: number;
  readonly cleanupTimeoutMs: number;
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const timer = setTimeout(finished, milliseconds);
  signal?.addEventListener('abort', aborted, { once: true });
  function finished(): void {
    signal?.removeEventListener('abort', aborted);
    resolve();
  }
  function aborted(): void {
    clearTimeout(timer);
    signal?.removeEventListener('abort', aborted);
    reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
  }
  return promise;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function isTerminal(state: SubscriptionUnitState): boolean {
  return state.activeState === 'failed' || state.activeState === 'inactive';
}

export class SubscriptionSandboxLifecycle {
  constructor(
    private readonly controller: SubscriptionSandboxController,
    private readonly timeouts: SubscriptionSandboxTimeouts
  ) {}

  async waitForDirectory(
    name: string,
    path: string,
    signal: AbortSignal,
    phase: SubscriptionSandboxPhase
  ): Promise<void> {
    const deadline = Date.now() + this.timeouts.requestHandoffTimeoutMs;
    while (Date.now() < deadline) {
      this.throwIfAborted(signal, phase);
      const state = await this.controller.show(name);
      if (isTerminal(state)) {
        throw new SubscriptionSandboxError(
          'Systemd unit failed before creating IPC.',
          'start',
          phase
        );
      }
      if (await exists(path)) return;
      await delay(this.timeouts.pollIntervalMs, signal);
    }
    throw new SubscriptionSandboxError(
      'Invocation directory handoff timed out.',
      'timeout',
      phase
    );
  }

  async waitForMain(
    name: string,
    signal: AbortSignal,
    phase: SubscriptionSandboxPhase
  ): Promise<SubscriptionUnitState> {
    const deadline = Date.now() + this.timeouts.startupTimeoutMs;
    while (Date.now() < deadline) {
      this.throwIfAborted(signal, phase);
      const state = await this.controller.show(name);
      if (
        (state.activeState === 'activating' && state.subState === 'start') ||
        (state.activeState === 'active' && state.subState === 'running')
      ) {
        return state;
      }
      if (isTerminal(state)) {
        throw new SubscriptionSandboxError(
          'Systemd unit failed before MAIN.',
          'start',
          phase
        );
      }
      await delay(this.timeouts.pollIntervalMs, signal);
    }
    throw new SubscriptionSandboxError(
      'Sandbox MAIN transition timed out.',
      'timeout',
      phase
    );
  }

  async waitForReady(
    name: string,
    initialState: SubscriptionUnitState,
    signal: AbortSignal,
    phase: SubscriptionSandboxPhase
  ): Promise<void> {
    const deadline = Date.now() + this.timeouts.startupTimeoutMs;
    let state = initialState;
    while (Date.now() < deadline) {
      this.throwIfAborted(signal, phase);
      if (state.activeState === 'active' && state.subState === 'running') return;
      if (isTerminal(state)) {
        throw new SubscriptionSandboxError(
          'Systemd unit failed before READY.',
          'start',
          phase
        );
      }
      await delay(this.timeouts.pollIntervalMs, signal);
      state = await this.controller.show(name);
    }
    throw new SubscriptionSandboxError(
      'Sandbox READY transition timed out.',
      'timeout',
      phase
    );
  }

  async waitForResult(
    name: string,
    directory: VerifiedInvocationDirectory,
    profile: SubscriptionSandboxProfile,
    invocation: SubscriptionInvocation,
    signal: AbortSignal,
    phase: SubscriptionSandboxPhase
  ): Promise<SubscriptionResultEnvelope> {
    const deadline = Date.now() + this.timeouts.executionTimeoutMs;
    while (Date.now() < deadline) {
      this.throwIfAborted(signal, phase);
      const state = await this.controller.show(name);
      if (isTerminal(state)) {
        throw new SubscriptionSandboxError(
          'Sandbox terminated before result publication.',
          'state',
          phase
        );
      }
      if (state.statusText === 'result-published') {
        const result = await readVerifiedIpcJson({
          directory,
          fileName: 'result.json',
          schema: SubscriptionResultEnvelopeSchema,
          maximumBytes: IPC_LIMITS.result,
          expectedUid: profile.adapterUid,
          expectedGid: profile.ipcGid,
          expectedMode: 0o640
        });
        if (
          result.adapter !== profile.adapter ||
          result.attemptId !== invocation.attemptId ||
          (result.clientExit.code === null && result.clientExit.signal === null)
        ) {
          throw new SubscriptionSandboxError(
            'Result evidence does not match invocation.',
            'ipc',
            phase
          );
        }
        return result;
      }
      await delay(this.timeouts.pollIntervalMs, signal);
    }
    throw new SubscriptionSandboxError(
      'Provider execution timed out.',
      'timeout',
      phase
    );
  }

  async cleanup(
    name: string,
    path: string,
    phase: SubscriptionSandboxPhase
  ): Promise<void> {
    await this.controller.stop(name);
    await this.controller.killAll(name);
    await this.controller.waitTerminal(name, this.timeouts.cleanupTimeoutMs);
    if (!(await this.controller.isCgroupEmpty(name))) {
      throw new SubscriptionSandboxError(
        'Sandbox cgroup is not empty.',
        'cleanup',
        phase
      );
    }
    const deadline = Date.now() + this.timeouts.cleanupTimeoutMs;
    while (Date.now() < deadline) {
      if (!(await exists(path))) return;
      await delay(this.timeouts.pollIntervalMs);
    }
    throw new SubscriptionSandboxError(
      'Invocation directory survived ExecStopPost.',
      'cleanup',
      phase
    );
  }

  throwIfAborted(
    signal: AbortSignal,
    phase: SubscriptionSandboxPhase
  ): void {
    if (signal.aborted) {
      throw new SubscriptionSandboxError(
        'Sandbox invocation was cancelled.',
        'cancelled',
        phase,
        signal.reason
      );
    }
  }
}
