import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { IPC_LIMITS, SubscriptionRequestEnvelopeSchema, SubscriptionResultEnvelopeSchema, verifyInvocationDirectory, writeAtomicIpcJson } from '@ara/ai-router';
import type { SubscriptionAdapter } from '@ara/shared';
import type { SubscriptionSandboxController, SubscriptionUnitState } from '../providers/systemd-subscription-controller';
import { SystemdSubscriptionSandbox } from '../providers/systemd-subscription-sandbox';

const execFileAsync = promisify(execFile);
const gcOwner = resolve(import.meta.dirname, '../../../../ops/subscription-providers/subscription-gc-decision.mjs');

async function observeGcDecision(activeState: string, ageMinutes: number): Promise<string> {
  const { stdout } = await execFileAsync(process.execPath, [gcOwner, activeState, String(ageMinutes)], { timeout: 1_000, maxBuffer: 64 });
  return stdout.trim();
}
export type LocalEvidenceScenario = 'success' | 'missing-ready' | 'status-before-ready' | 'result-before-ready' | 'start-failure' | 'non-atomic-result' | 'wrong-result-digest' | 'stop-failure' | 'cgroup-not-empty' | 'cleanup-residue';

const state = (overrides: Partial<SubscriptionUnitState> = {}): SubscriptionUnitState => ({
  activeState: 'activating', subState: 'start-pre', statusText: '', execMainCode: 0,
  execMainStatus: 0, result: 'success', ...overrides
});

class LocalEvidenceController implements SubscriptionSandboxController {
  readonly events: string[] = [];
  private shows = 0;
  constructor(private readonly scenario: LocalEvidenceScenario, private readonly invocationPath: string, private readonly root: string, private readonly adapter: SubscriptionAdapter, private readonly attemptId: string) {}

  async startNoBlock(): Promise<void> {
    this.events.push('start-no-block');
    if (this.scenario === 'start-failure') throw new Error('injected start failure');
    await mkdir(this.invocationPath, { mode: 0o2770 });
    this.events.push('directory-created');
  }

  async show(): Promise<SubscriptionUnitState> {
    this.shows += 1;
    this.events.push(`show-${this.shows}`);
    if (this.shows === 2) {
      const request = SubscriptionRequestEnvelopeSchema.parse(JSON.parse(await readFile(join(this.invocationPath, 'request.json'), 'utf8')));
      if (request.attemptId !== this.attemptId || request.adapter !== this.adapter) throw new TypeError('Observed request identity drift.');
      this.events.push('request-observed');
    }
    if (this.scenario === 'missing-ready' && this.shows >= 2) return state({ activeState: 'failed', subState: 'failed' });
    if (this.scenario === 'status-before-ready' && this.shows === 2) return state({ statusText: 'result-published' });
    if (this.scenario === 'result-before-ready' && this.shows === 2) {
      await this.publishResult();
      return state({ statusText: 'result-published' });
    }
    if (this.shows === 1) return state();
    if (this.shows === 2) { this.events.push('ready-observed'); return state({ activeState: 'active', subState: 'running' }); }
    await this.publishResult();
    this.events.push('result-status-observed');
    return state({ activeState: 'active', subState: 'running', statusText: 'result-published' });
  }

  private async publishResult(): Promise<void> {
    if (this.scenario === 'non-atomic-result') {
      await writeFile(join(this.invocationPath, 'result.json'), '{', { flag: 'wx', mode: 0o640 });
      return;
    }
    const directory = await verifyInvocationDirectory({ directoryPath: this.invocationPath, expectedRoot: this.root, instanceId: this.attemptId, expectedMode: 0o2770 });
    try {
      await writeAtomicIpcJson({
        directory, temporaryName: 'result.tmp', finalName: 'result.json',
        value: { version: 1, adapter: this.adapter, attemptId: this.attemptId, outcome: 'success', rawOutput: this.scenario === 'wrong-result-digest' ? 'changed' : '{"ok":true}', clientExit: { code: 0, signal: null } },
        schema: SubscriptionResultEnvelopeSchema, maximumBytes: IPC_LIMITS.result, mode: 0o640
      });
      this.events.push('result-atomically-published');
    } finally { await directory.close(); }
  }

  async stop(): Promise<void> { this.events.push('explicit-stop'); if (this.scenario === 'stop-failure') throw new Error('injected stop failure'); }
  async killAll(): Promise<void> { this.events.push('kill-all'); }
  async waitTerminal(): Promise<void> {
    this.events.push('terminal-observed');
    if (this.scenario !== 'cleanup-residue') await rm(this.invocationPath, { recursive: true, force: true });
    this.events.push('exec-stop-post-observed');
  }
  async isCgroupEmpty(): Promise<boolean> { this.events.push('cgroup-observed'); return this.scenario !== 'cgroup-not-empty'; }
}

export async function runLocalSubscriptionEvidence(adapter: SubscriptionAdapter, scenario: LocalEvidenceScenario = 'success') {
  const root = join(tmpdir(), `ara-task14-owner-${randomUUID()}`);
  const attemptId = randomUUID();
  const invocationPath = join(root, attemptId);
  const controller = new LocalEvidenceController(scenario, invocationPath, root, adapter, attemptId);
  const sandbox = new SystemdSubscriptionSandbox({ controller, pollIntervalMs: 1, requestHandoffTimeoutMs: 100, startupTimeoutMs: 100, executionTimeoutMs: 100, cleanupTimeoutMs: 100 });
  await mkdir(root, { mode: 0o750 });
  try {
    const result = await sandbox.run({ adapter, profileId: `${adapter}-subscription-v1`, unitTemplate: `amazon-research-${adapter}@.service`, invocationRoot: root }, {
      attemptId, modelId: adapter === 'codex' ? 'gpt-5.6' : 'fixture-grok', role: 'niche_normalization', locale: 'en', prompt: 'local disposable fixture', inputHash: '0'.repeat(64)
    }, new AbortController().signal);
    const required = ['start-no-block', 'directory-created', 'request-observed', 'ready-observed', 'result-atomically-published', 'result-status-observed', 'explicit-stop', 'kill-all', 'terminal-observed', 'exec-stop-post-observed', 'cgroup-observed'];
    const observed = required.every((event) => controller.events.includes(event));
    const gc = await Promise.all([['active', 30], ['inactive', 5], ['unknown', 30], ['inactive', 11]].map(async ([activeState, ageMinutes]) => ({ activeState, ageMinutes, decision: await observeGcDecision(String(activeState), Number(ageMinutes)) })));
    const ok = observed && result.rawOutput === '{"ok":true}';
    return { schemaVersion: 1, ok, adapter, provenance: 'task5-owner-executed-v1', events: controller.events, gc, localFixtureVerified: ok, oracleHostVerified: false, liveProviderVerified: false };
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function main(): Promise<void> {
  const adapter = process.argv[2];
  if ((adapter !== 'codex' && adapter !== 'grok') || process.argv.length !== 3) throw new TypeError('Closed local evidence arguments rejected.');
  process.stdout.write(`${JSON.stringify(await runLocalSubscriptionEvidence(adapter))}\n`);
}

if (process.argv[1]?.endsWith('subscription-local-evidence.ts')) {
  main().catch(() => { process.stdout.write('{"schemaVersion":1,"ok":false,"localFixtureVerified":false,"oracleHostVerified":false,"liveProviderVerified":false}\n'); process.exitCode = 1; });
}
