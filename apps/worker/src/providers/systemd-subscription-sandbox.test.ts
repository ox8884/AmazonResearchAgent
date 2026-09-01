import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  SubscriptionSandboxController,
  SubscriptionUnitState
} from './systemd-subscription-sandbox';
import { SystemdSubscriptionSandbox } from './systemd-subscription-sandbox';
import { subscriptionSystemctlArguments } from './systemd-subscription-controller';
import { loadSubscriptionSandboxArtifacts } from './subscription-sandbox-policy';
import { runLocalSubscriptionEvidence, type LocalEvidenceScenario } from '../commands/subscription-local-evidence';

const roots: string[] = [];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const execFileAsync = promisify(execFile);
const supervisorPath = join(
  repositoryRoot,
  'ops/subscription-providers/subscription-supervisor.mjs'
);

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

async function createExactInvocationDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o2770 });
  await chmod(path, 0o2770);
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
      onStart: async () => createExactInvocationDirectory(path),
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
      onStart: async () => createExactInvocationDirectory(path),
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
    const controller = new FakeController({ onStart: async () => createExactInvocationDirectory(path) });
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
    const controller = new FakeController({ onStart: async () => createExactInvocationDirectory(path) });
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
      onStart: async () => createExactInvocationDirectory(path),
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
          if (scenario[1]) await createExactInvocationDirectory(path);
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
    const controller = new FakeController({ onStart: async () => createExactInvocationDirectory(path) });
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
      await createExactInvocationDirectory(path);
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
    const controller = new FakeController({ onStart: async () => createExactInvocationDirectory(path) });
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
      onStart: async () => createExactInvocationDirectory(path),
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

describe('Task-14 local evidence executes Task-5 owners', () => {
  it('derives exact ordered evidence from the real sandbox lifecycle and IPC helpers', async () => {
    const report = await runLocalSubscriptionEvidence('codex');
    expect(report.ok).toBe(true);
    expect(report.schemaVersion).toBe(2);
    expect(report.provenance).toBe('task5-owner-executed-v2');
    expect(report.events.map((event) => event.kind)).toEqual([
      'start-no-block', 'directory-created', 'unit-state', 'unit-state', 'request-observed', 'ready-observed',
      'unit-state', 'result-atomically-published', 'result-status-observed', 'explicit-stop', 'kill-all',
      'terminal-observed', 'exec-stop-post-observed', 'cgroup-observed'
    ]);
    expect(report.request).toMatchObject({ adapter: 'codex', attemptId: report.attemptId, atomic: true, expectedMode: 0o640 });
    expect(report.result).toMatchObject({ adapter: 'codex', attemptId: report.attemptId, atomic: true, expectedMode: 0o640 });
    expect(report.gc).toEqual([
      { activeState: 'active', ageMinutes: 30, decision: 'retain' },
      { activeState: 'inactive', ageMinutes: 5, decision: 'retain' },
      { activeState: 'unknown', ageMinutes: 30, decision: 'retain' },
      { activeState: 'inactive', ageMinutes: 11, decision: 'remove' }
    ]);
    expect(report.cleanup).toEqual({ relativeRoot: report.attemptId, absent: true });
    expect(report.oracleHostVerified).toBe(false);
    expect(report.liveProviderVerified).toBe(false);
  });
  it.skipIf(process.platform === 'win32')('establishes exact 02770 under a restrictive umask', async () => {
    const previous = process.umask(0o027);
    try {
      const report = await runLocalSubscriptionEvidence('codex');
      expect(report.ok).toBe(true);
      expect(report.events.find((event) => event.kind === 'directory-created')?.observed.mode).toBe(0o2770);
    } finally {
      process.umask(previous);
    }
  });


  it.each([
    'missing-ready', 'status-before-ready', 'result-before-ready', 'start-failure',
    'non-atomic-result', 'stop-failure', 'cgroup-not-empty', 'cleanup-residue'
  ] satisfies readonly LocalEvidenceScenario[])('rejects hostile %s evidence', async (scenario) => {
    await expect(runLocalSubscriptionEvidence('codex', scenario)).rejects.toBeDefined();
  });

  it('does not accept changed result evidence', async () => {
    const report = await runLocalSubscriptionEvidence('codex', 'wrong-result-digest');
    expect(report.ok).toBe(false);
    expect(report.localFixtureVerified).toBe(false);
  });
});

describe('subscription supervisor request boundary', () => {
  type SupervisorFixture = {
    readonly root: string;
    readonly attemptId: string;
    readonly invocation: string;
    readonly approved: string;
    readonly request: Readonly<Record<string, unknown>>;
    readonly environment: NodeJS.ProcessEnv;
  };

  async function supervisorFixture(
    overrides: Readonly<Record<string, unknown>> = {}
  ): Promise<SupervisorFixture> {
    const root = join(tmpdir(), `ara-supervisor-${randomUUID()}`);
    roots.push(root);
    const attemptId = randomUUID();
    const adapterRoot = join(root, 'codex');
    const invocation = join(adapterRoot, attemptId);
    const approvedRoot = join(adapterRoot, '.approved');
    const approved = join(approvedRoot, attemptId);
    await mkdir(adapterRoot, { recursive: true, mode: 0o750 });
    await chmod(adapterRoot, 0o750);
    await mkdir(invocation, { mode: 0o2770 });
    await chmod(invocation, 0o2770);
    await mkdir(approvedRoot, { mode: 0o750 });
    await chmod(approvedRoot, 0o750);
    await mkdir(approved, { mode: 0o2550 });
    await chmod(approved, 0o2550);
    const request = {
      version: 1,
      adapter: 'codex',
      profileId: 'codex-subscription-v1',
      attemptId,
      modelId: 'gpt-5.6',
      role: 'niche_normalization',
      locale: 'en',
      prompt: 'normalize',
      inputHash: 'a'.repeat(64),
      ...overrides
    };
    await writeFile(join(invocation, 'request.json'), JSON.stringify(request), { mode: 0o640 });
    await chmod(join(invocation, 'request.json'), 0o640);
    const uid = String(process.getuid?.() ?? 0);
    const gid = String(process.getgid?.() ?? 0);
    return {
      root,
      attemptId,
      invocation,
      approved,
      request,
      environment: {
        ...process.env,
        NODE_ENV: 'test',
        ARA_SUBSCRIPTION_RUNTIME_ROOT: root,
        ARA_TEST_APPROVED_UID: uid,
        ARA_TEST_APPROVED_GID: gid
      }
    };
  }

  async function approve(fixture: SupervisorFixture): Promise<void> {
    await execFileAsync(process.execPath, [
      supervisorPath,
      '--approve-request',
      'codex',
      fixture.attemptId,
      fixture.environment.ARA_TEST_APPROVED_GID ?? ''
    ], { env: fixture.environment });
  }

  async function validateApproved(fixture: SupervisorFixture): Promise<void> {
    await execFileAsync(process.execPath, [
      supervisorPath,
      '--validate-approved',
      'codex',
      fixture.attemptId
    ], { env: fixture.environment });
  }

  // Break: recursive fixture setup creates an unwritable approved parent before its attempt child.
  it.skipIf(process.platform === 'win32')('creates authority parents independently under a restrictive umask', async () => {
    const previous = process.umask(0o027);
    try {
      const fixture = await supervisorFixture();
      expect((await lstat(dirname(fixture.invocation))).mode & 0o7777).toBe(0o750);
      expect((await lstat(dirname(fixture.approved))).mode & 0o7777).toBe(0o750);
      expect((await lstat(fixture.invocation)).mode & 0o7777).toBe(0o2770);
      expect((await lstat(fixture.approved)).mode & 0o7777).toBe(0o2550);
    } finally {
      process.umask(previous);
    }
  });

  it('seals and independently validates only the exact Codex request identity', async () => {
    const fixture = await supervisorFixture();
    await expect(approve(fixture)).resolves.toBeUndefined();
    await expect(lstat(join(fixture.invocation, 'request.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(join(fixture.approved, 'request.json'), 'utf8'))).toEqual(fixture.request);
    await expect(validateApproved(fixture)).resolves.toBeUndefined();
  });

  it.each([
    ['unknown key', { command: '/bin/sh' }],
    ['wrong profile', { profileId: 'alternate-profile' }],
    ['wrong model', { modelId: 'alternate-model' }]
  ])('rejects %s before sealing', async (_name, overrides) => {
    const fixture = await supervisorFixture(overrides);
    await expect(approve(fixture)).rejects.toBeDefined();
  });

  it('rejects an oversized request object before sealing', async () => {
    const fixture = await supervisorFixture({ prompt: 'x'.repeat(300_000) });
    await expect(approve(fixture)).rejects.toBeDefined();
  });

  it('ignores source replacement between root approval and MAIN validation', async () => {
    const fixture = await supervisorFixture();
    await approve(fixture);
    await writeFile(join(fixture.invocation, 'request.json'), JSON.stringify({ command: '/bin/sh' }));
    await expect(validateApproved(fixture)).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(join(fixture.approved, 'request.json'), 'utf8'))).toEqual(fixture.request);
  });

  it('rejects a changed sealed request inode', async () => {
    const fixture = await supervisorFixture();
    await approve(fixture);
    const path = join(fixture.approved, 'request.json');
    await chmod(path, 0o640);
    await writeFile(path, JSON.stringify({ ...fixture.request, profileId: 'alternate-profile' }));
    await chmod(path, 0o440);
    await expect(validateApproved(fixture)).rejects.toBeDefined();
  });

  it('rejects approved directory substitution', async () => {
    const fixture = await supervisorFixture();
    await approve(fixture);
    const displaced = `${fixture.approved}-displaced`;
    await rename(fixture.approved, displaced);
    await mkdir(fixture.approved, { mode: 0o2550 });
    await chmod(fixture.approved, 0o2550);
    const path = join(fixture.approved, 'request.json');
    await writeFile(path, JSON.stringify({ ...fixture.request, modelId: 'alternate-model' }), { mode: 0o440 });
    await chmod(path, 0o440);
    await expect(validateApproved(fixture)).rejects.toBeDefined();
  });

  it.skipIf(process.platform === 'win32')('rejects approved directory symlink substitution', async () => {
    const fixture = await supervisorFixture();
    await approve(fixture);
    const displaced = `${fixture.approved}-displaced`;
    await rename(fixture.approved, displaced);
    await symlink(displaced, fixture.approved, 'dir');
    await expect(validateApproved(fixture)).rejects.toBeDefined();
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
      loadSubscriptionSandboxArtifacts(repositoryRoot, 'codex'),
      loadSubscriptionSandboxArtifacts(repositoryRoot, 'codex'),
      loadSubscriptionSandboxArtifacts(repositoryRoot, 'grok')
    ]);
    expect(codex.artifactDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(codexAgain.artifactDigest).toBe(codex.artifactDigest);
    expect(grok.artifactDigest).not.toBe(codex.artifactDigest);
    expect(codex.artifacts.map((artifact) => artifact.path)).toContain(
      'ops/systemd/amazon-research-codex@.service'
    );
  });

  it.each(['codex', 'grok'] as const)(
    'enforces fixed %s unit isolation',
    async (adapter) => {
      const policy = await loadSubscriptionSandboxArtifacts(repositoryRoot, adapter);
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
    const policy = await loadSubscriptionSandboxArtifacts(repositoryRoot, 'codex');
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
    const policy = await loadSubscriptionSandboxArtifacts(repositoryRoot, 'codex');
    const helper = policy.artifacts.find((artifact) => artifact.path.endsWith('manage-invocation.sh'))?.content ?? '';
    const gc = policy.artifacts.find((artifact) => artifact.path.endsWith('-gc.service'))?.content ?? '';
    expect(helper).toContain("install -d -o amazon-research -g \"$GROUP\" -m 2770");
    expect(helper).toContain('while (( elapsed < 50 ))');
    expect(helper).toContain('systemctl show "$unit" --property=ActiveState --value');
    expect(helper).toContain('decision="$(/usr/bin/node "$GC_DECISION" "$active" "$age")"');
    expect(gc).toContain('manage-invocation.sh gc codex');
    expect(gc).toContain('manage-invocation.sh gc grok');
  });
});
