import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  SubscriptionSandboxController,
  SubscriptionUnitState
} from './systemd-subscription-sandbox';
import { SystemdSubscriptionSandbox } from './systemd-subscription-sandbox';
import { subscriptionSystemctlArguments } from './systemd-subscription-controller';
import { loadSubscriptionSandboxPolicy } from './subscription-sandbox-policy';

const roots: string[] = [];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function state(overrides: Partial<SubscriptionUnitState> = {}): SubscriptionUnitState {
  return {
    activeState: 'activating',
    subState: 'start-pre',
    statusText: '',
    execMainCode: 0,
    execMainStatus: 0,
    result: 'success',
    ...overrides
  };
}

class FakeController implements SubscriptionSandboxController {
  readonly events: string[] = [];
  readonly states: SubscriptionUnitState[] = [];
  readonly onStart: (() => Promise<void>) | undefined;
  readonly onShow: ((showCount: number) => Promise<void>) | undefined;
  cleanupPath: string | undefined;
  stopped = false;

  constructor(options: {
    readonly onStart?: () => Promise<void>;
    readonly onShow?: (showCount: number) => Promise<void>;
  } = {}) {
    this.onStart = options.onStart;
    this.onShow = options.onShow;
  }

  async startNoBlock(unitName: string): Promise<void> {
    this.events.push(`start:${unitName}`);
    await this.onStart?.();
  }

  async show(): Promise<SubscriptionUnitState> {
    this.events.push('show');
    const count = this.events.filter((event) => event === 'show').length;
    await this.onShow?.(count);
    return this.states.shift() ?? state({ activeState: 'failed', subState: 'failed', result: 'exit-code' });
  }

  async stop(): Promise<void> {
    this.events.push('stop');
    this.stopped = true;
  }

  async killAll(): Promise<void> {
    this.events.push('kill-all');
  }

  async waitTerminal(): Promise<void> {
    this.events.push('terminal');
    if (this.cleanupPath !== undefined) {
      await rm(this.cleanupPath, { recursive: true, force: true });
    }
  }

  async isCgroupEmpty(): Promise<boolean> {
    this.events.push('cgroup-empty');
    return true;
  }
}

async function fixture(
  controller: FakeController,
  options: { readonly requestTimeoutMs?: number } = {}
) {
  const root = join(tmpdir(), `ara-sandbox-${randomUUID()}`);
  roots.push(root);
  await mkdir(root, { recursive: true });
  const attemptId = randomUUID();
  const invocationPath = join(root, attemptId);
  controller.cleanupPath = invocationPath;
  const sandbox = new SystemdSubscriptionSandbox({
    controller,
    pollIntervalMs: 1,
    requestHandoffTimeoutMs: options.requestTimeoutMs ?? 100,
    startupTimeoutMs: 200,
    executionTimeoutMs: 200,
    cleanupTimeoutMs: 100
  });
  const profile = {
    adapter: 'codex' as const,
    profileId: 'codex-fixture-v1',
    unitTemplate: 'amazon-research-codex@.service' as const,
    invocationRoot: root,
    workerUid: process.getuid?.(),
    ipcGid: process.getgid?.()
  };
  const invocation = {
    attemptId,
    modelId: 'fixture-model',
    role: 'niche_normalization' as const,
    locale: 'en',
    prompt: 'fixture prompt',
    inputHash: 'a'.repeat(64)
  };
  return { sandbox, profile, invocation, invocationPath };
}

async function publishResult(path: string, attemptId: string): Promise<void> {
  await writeFile(join(path, 'result.json'), JSON.stringify({
    version: 1,
    adapter: 'codex',
    attemptId,
    outcome: 'success',
    rawOutput: '{"classification":"product_niche"}',
    clientExit: { code: 0, signal: null }
  }), { mode: 0o640 });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('SystemdSubscriptionSandbox start and lifecycle', () => {
  // Break: synchronous start blocks the worker that must publish request.json.
  it('nonblocking start creates exact invocation directory', async () => {
    let path = '';
    let attemptId = '';
    const controller = new FakeController({
      onStart: async () => mkdir(path, { mode: 0o770 }),
      onShow: async (count) => {
        if (count === 3) await publishResult(path, attemptId);
      }
    });
    const f = await fixture(controller);
    path = f.invocationPath;
    attemptId = f.invocation.attemptId;
    controller.states.push(
      state(),
      state({ activeState: 'active', subState: 'running' }),
      state({ activeState: 'active', subState: 'running', statusText: 'result-published' })
    );

    const result = await f.sandbox.run(f.profile, f.invocation, new AbortController().signal);

    expect(result.outcome).toBe('success');
    expect(controller.events[0]).toBe(`start:amazon-research-codex@${attemptId}.service`);
  });

  // Break: ExecStartPre is allowed to wait without a bounded handoff deadline.
  it('ExecStartPre waits before request json', async () => {
    const controller = new FakeController();
    controller.states.push(...Array.from({ length: 40 }, () => state()));
    const f = await fixture(controller, { requestTimeoutMs: 10 });

    await expect(f.sandbox.run(f.profile, f.invocation, new AbortController().signal)).rejects.toMatchObject({
      kind: 'timeout',
      phase: 'S1'
    });
    expect(controller.stopped).toBe(true);
  });

  // Break: a valid final request does not release pre-start into MAIN.
  it('valid request releases ExecStartPre', async () => {
    let path = '';
    let requestObserved = '';
    const controller = new FakeController({
      onStart: async () => mkdir(path, { mode: 0o770 }),
      onShow: async (count) => {
        if (count === 2) requestObserved = await readFile(join(path, 'request.json'), 'utf8');
      }
    });
    const f = await fixture(controller);
    path = f.invocationPath;
    controller.states.push(
      state(),
      state({ activeState: 'active', subState: 'running' }),
      state({ activeState: 'failed', subState: 'failed' })
    );

    await expect(f.sandbox.run(f.profile, f.invocation, new AbortController().signal)).rejects.toMatchObject({ phase: 'S5' });
    expect(requestObserved).toContain(f.invocation.attemptId);
  });

  // Break: MAIN/provider execution is inferred before start-pre completes and READY is accepted.
  it('MAIN waits for ExecStartPre completion', async () => {
    let path = '';
    const controller = new FakeController({ onStart: async () => mkdir(path, { mode: 0o770 }) });
    const f = await fixture(controller);
    path = f.invocationPath;
    controller.states.push(
      state(),
      state({ subState: 'start-pre' }),
      state({ subState: 'start' }),
      state({ activeState: 'active', subState: 'running' }),
      state({ activeState: 'failed', subState: 'failed' })
    );

    await expect(f.sandbox.run(f.profile, f.invocation, new AbortController().signal)).rejects.toMatchObject({ phase: 'S5' });
    expect(controller.events.filter((event) => event === 'show')).toHaveLength(5);
  });

  // Break: STATUS=result-published is treated as READY while Type=notify is still activating.
  it('READY follows MAIN sandbox validation', async () => {
    let path = '';
    const controller = new FakeController({ onStart: async () => mkdir(path, { mode: 0o770 }) });
    const f = await fixture(controller);
    path = f.invocationPath;
    controller.states.push(
      state({ statusText: 'result-published' }),
      state({ activeState: 'failed', subState: 'failed' })
    );

    await expect(f.sandbox.run(f.profile, f.invocation, new AbortController().signal)).rejects.toMatchObject({ phase: 'S3' });
  });

  // Break: provider result can be ingested before READY/active-running.
  it('provider execution follows READY', async () => {
    let path = '';
    let attemptId = '';
    const controller = new FakeController({
      onStart: async () => mkdir(path, { mode: 0o770 }),
      onShow: async (count) => {
        if (count === 3) await publishResult(path, attemptId);
      }
    });
    const f = await fixture(controller);
    path = f.invocationPath;
    attemptId = f.invocation.attemptId;
    controller.states.push(
      state(),
      state({ activeState: 'active', subState: 'running' }),
      state({ activeState: 'active', subState: 'running', statusText: 'result-published' })
    );

    const result = await f.sandbox.run(f.profile, f.invocation, new AbortController().signal);

    expect(result.attemptId).toBe(attemptId);
  });

  for (const scenario of [
    ['cancellation while waiting for directory cleans exact unit', false, 0],
    ['cancellation after directory before request cleans exact unit', true, 1],
    ['cancellation after request before READY cleans exact unit', true, 2]
  ] as const) {
    // Break: a pre-READY abort leaks the fixed unit/cgroup or invocation path.
    it(scenario[0], async () => {
      const abort = new AbortController();
      let path = '';
      const controller = new FakeController({
        onStart: async () => {
          if (scenario[1]) await mkdir(path, { mode: 0o770 });
          if (!scenario[1]) abort.abort();
        },
        onShow: async (count) => {
          if (count === scenario[2]) abort.abort();
        }
      });
      const f = await fixture(controller);
      path = f.invocationPath;
      controller.states.push(state(), state());

      await expect(f.sandbox.run(f.profile, f.invocation, abort.signal)).rejects.toMatchObject({ kind: 'cancelled' });
      expect(controller.events).toEqual(expect.arrayContaining(['stop', 'kill-all', 'terminal', 'cgroup-empty']));
    });
  }

  // Break: a rejected start still leaves artifacts or attempts request publication.
  it('start failure before directory leaves nothing', async () => {
    const controller = new FakeController({ onStart: async () => { throw new Error('denied'); } });
    const f = await fixture(controller);

    await expect(f.sandbox.run(f.profile, f.invocation, new AbortController().signal)).rejects.toMatchObject({ phase: 'S1' });
    await expect(lstat(f.invocationPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // Break: failed startup after root directory creation skips stop/ExecStopPost cleanup.
  it('start failure after directory removes directory', async () => {
    let path = '';
    const controller = new FakeController({ onStart: async () => mkdir(path, { mode: 0o770 }) });
    const f = await fixture(controller);
    path = f.invocationPath;
    controller.states.push(state({ activeState: 'failed', subState: 'failed' }));

    await expect(f.sandbox.run(f.profile, f.invocation, new AbortController().signal)).rejects.toBeDefined();
    await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // Break: a conflicting/malformed final request can be replaced and start MAIN.
  it('invalid request fails startup and cleans', async () => {
    let path = '';
    const controller = new FakeController({ onStart: async () => {
      await mkdir(path, { mode: 0o770 });
      await writeFile(join(path, 'request.json'), '{');
    } });
    const f = await fixture(controller);
    path = f.invocationPath;
    controller.states.push(state());

    await expect(f.sandbox.run(f.profile, f.invocation, new AbortController().signal)).rejects.toMatchObject({ phase: 'S2' });
    expect(controller.stopped).toBe(true);
  });

  // Break: directory handoff can wait past its fixed deadline.
  it('request handoff timeout fails startup', async () => {
    const controller = new FakeController();
    controller.states.push(...Array.from({ length: 40 }, () => state()));
    const f = await fixture(controller, { requestTimeoutMs: 5 });

    await expect(f.sandbox.run(f.profile, f.invocation, new AbortController().signal)).rejects.toMatchObject({ kind: 'timeout' });
  });

  // Break: start waits synchronously for ExecStartPre instead of returning control for publication.
  it('nonblocking start avoids request publication deadlock', async () => {
    let path = '';
    const controller = new FakeController({ onStart: async () => mkdir(path, { mode: 0o770 }) });
    const f = await fixture(controller);
    path = f.invocationPath;
    controller.states.push(state(), state({ activeState: 'failed', subState: 'failed' }));

    await expect(f.sandbox.run(f.profile, f.invocation, new AbortController().signal)).rejects.toBeDefined();
    expect(controller.events.slice(0, 2)).toEqual([
      `start:amazon-research-codex@${f.invocation.attemptId}.service`,
      'show'
    ]);
  });

  // Break: result publication terminates the unit before ingestion or cleanup order is inverted.
  it('READY result status and ExecStopPost lifecycle remains ordered', async () => {
    let path = '';
    let attemptId = '';
    const controller = new FakeController({
      onStart: async () => mkdir(path, { mode: 0o770 }),
      onShow: async (count) => {
        if (count === 3) await publishResult(path, attemptId);
      }
    });
    const f = await fixture(controller);
    path = f.invocationPath;
    attemptId = f.invocation.attemptId;
    controller.states.push(
      state(),
      state({ activeState: 'active', subState: 'running' }),
      state({ activeState: 'active', subState: 'running', statusText: 'result-published' })
    );

    await f.sandbox.run(f.profile, f.invocation, new AbortController().signal);

    expect(controller.events.slice(-4)).toEqual(['stop', 'kill-all', 'terminal', 'cgroup-empty']);
  });
});

describe('subscription sandbox host policy', () => {
  const instance = '00000000-0000-4000-8000-000000000000';
  const unit = `amazon-research-codex@${instance}.service`;

  it('fixes adapter unit selection UUID identity and systemctl capabilities', () => {
    expect(subscriptionSystemctlArguments('start', unit)).toEqual([
      'start',
      '--no-block',
      unit
    ]);
    expect(subscriptionSystemctlArguments('kill', unit)).toEqual([
      'kill',
      '--kill-who=all',
      unit
    ]);
    expect(subscriptionSystemctlArguments('show', unit)).toEqual([
      'show',
      unit,
      '--property', 'ActiveState',
      '--property', 'SubState',
      '--property', 'StatusText',
      '--property', 'ExecMainCode',
      '--property', 'ExecMainStatus',
      '--property', 'Result'
    ]);
    expect(() => subscriptionSystemctlArguments(
      'start',
      'amazon-research-codex@../escape.service'
    )).toThrow();
  });

  it('binds immutable host artifacts into adapter policy digests', async () => {
    const [codex, codexAgain, grok] = await Promise.all([
      loadSubscriptionSandboxPolicy(repositoryRoot, 'codex'),
      loadSubscriptionSandboxPolicy(repositoryRoot, 'codex'),
      loadSubscriptionSandboxPolicy(repositoryRoot, 'grok')
    ]);
    expect(codex.digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(codexAgain.digest).toBe(codex.digest);
    expect(grok.digest).not.toBe(codex.digest);
    expect(codex.artifacts.map((artifact) => artifact.path)).toContain(
      'ops/systemd/amazon-research-codex@.service'
    );
  });

  it.each(['codex', 'grok'] as const)(
    'enforces fixed %s unit isolation',
    async (adapter) => {
      const policy = await loadSubscriptionSandboxPolicy(repositoryRoot, adapter);
      const unitArtifact = policy.artifacts.find(
        (artifact) => artifact.path.endsWith(`${adapter}@.service`)
      );
      expect(unitArtifact).toBeDefined();
      const text = unitArtifact?.content ?? '';
      expect(text).toContain('Type=notify');
      expect(text).toContain('NotifyAccess=main');
      expect(text).toContain('TimeoutStartSec=20');
      expect(text).toContain('TimeoutStopSec=15');
      expect(text).toContain('RuntimeMaxSec=150');
      expect(text).toContain('KillMode=control-group');
      expect(text).toContain('StandardOutput=null');
      expect(text).toContain('StandardError=null');
      expect(text).toContain('ProtectSystem=strict');
      expect(text).toContain('ProtectHome=yes');
      expect(text).toContain('PrivateTmp=yes');
      expect(text).toContain('IPAddressDeny=any');
      expect(text).toContain('IPAddressAllow=localhost');
      expect(text).toContain(
        'InaccessiblePaths=/opt/amazon-research/current /etc/amazon-research /home /root'
      );
      expect(text).toContain(`User=ara-${adapter}`);
      expect(text).toContain(`SupplementaryGroups=ara-${adapter}-ipc`);
      expect(text).not.toContain('/bin/sh');
      expect(text).not.toContain('/bin/bash');
    }
  );

  it('enforces cross-adapter polkit and IPv4 IPv6 nftables rejection', async () => {
    const policy = await loadSubscriptionSandboxPolicy(repositoryRoot, 'codex');
    const polkit = policy.artifacts.find((artifact) => artifact.path.includes('/polkit/'))?.content ?? '';
    const nftables = policy.artifacts.find((artifact) => artifact.path.includes('/nftables/'))?.content ?? '';
    expect(polkit).toContain("subject.user !== 'amazon-research'");
    expect(polkit).toContain('(codex|grok)@');
    expect(polkit).toContain("verb === 'start' || verb === 'stop' || verb === 'kill'");
    for (const adapter of ['ara-codex', 'ara-grok']) {
      expect(nftables).toContain(`meta skuid "${adapter}" ip daddr`);
      expect(nftables).toContain(`meta skuid "${adapter}" ip6 daddr`);
      expect(nftables).toContain(`meta skuid "${adapter}" reject`);
    }
  });

  it('keeps lifecycle helper bounded and root GC liveness aware', async () => {
    const policy = await loadSubscriptionSandboxPolicy(repositoryRoot, 'codex');
    const helper = policy.artifacts.find((artifact) => artifact.path.endsWith('manage-invocation.sh'))?.content ?? '';
    const gc = policy.artifacts.find((artifact) => artifact.path.endsWith('-gc.service'))?.content ?? '';
    expect(helper).toContain("install -d -o amazon-research -g \"$GROUP\" -m 2770");
    expect(helper).toContain('while (( elapsed < 50 ))');
    expect(helper).toContain('systemctl show "$unit" --property=ActiveState --value');
    expect(helper).toContain('[[ "$active" == inactive || "$active" == failed || -z "$active" ]]');
    expect(gc).toContain('manage-invocation.sh gc codex');
    expect(gc).toContain('manage-invocation.sh gc grok');
  });
});
