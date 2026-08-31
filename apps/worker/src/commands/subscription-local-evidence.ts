import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { IPC_LIMITS, SubscriptionRequestEnvelopeSchema, SubscriptionResultEnvelopeSchema, verifyInvocationDirectory, writeAtomicIpcJson } from '@ara/ai-router';
import type { SubscriptionAdapter } from '@ara/shared';
import type { SubscriptionSandboxController, SubscriptionUnitState } from '../providers/systemd-subscription-controller';
import { SystemdSubscriptionSandbox } from '../providers/systemd-subscription-sandbox';

const execFileAsync = promisify(execFile);
const gcOwner = resolve(import.meta.dirname, '../../../../ops/subscription-providers/subscription-gc-decision.mjs');
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

async function observeGcDecision(activeState: string, ageMinutes: number): Promise<string> {
  const { stdout, stderr } = await execFileAsync(process.execPath, [gcOwner, activeState, String(ageMinutes)], { timeout: 1_000, maxBuffer: 64 });
  if (stderr.length !== 0) throw new TypeError('GC owner emitted stderr.');
  return stdout.trim();
}

async function publishHandoff(root: string, name: 'request' | 'result', text: string): Promise<void> {
  const temporary = join(root, `${name}.tmp`);
  await writeFile(temporary, text, { flag: 'wx', mode: 0o640 });
  await chmod(temporary, 0o640);
  await rename(temporary, join(root, `${name}.json`));
}
export type LocalEvidenceScenario = 'success' | 'missing-ready' | 'status-before-ready' | 'result-before-ready' | 'start-failure' | 'non-atomic-result' | 'wrong-result-digest' | 'stop-failure' | 'cgroup-not-empty' | 'cleanup-residue';

const state = (overrides: Partial<SubscriptionUnitState> = {}): SubscriptionUnitState => ({
  activeState: 'activating', subState: 'start-pre', statusText: '', execMainCode: 0,
  execMainStatus: 0, result: 'success', ...overrides
});

type EvidenceEvent = Readonly<{ kind: string; observed: Readonly<Record<string, string | number | boolean>> }>;

class LocalEvidenceController implements SubscriptionSandboxController {
  readonly events: EvidenceEvent[] = [];
  requestEvidence: Readonly<Record<string, string | number | boolean>> | undefined;
  resultEvidence: Readonly<Record<string, string | number | boolean>> | undefined;
  private shows = 0;
  constructor(private readonly scenario: LocalEvidenceScenario, private readonly invocationPath: string, private readonly root: string, private readonly adapter: SubscriptionAdapter, private readonly attemptId: string, private readonly handoffRoot?: string) {}
  private event(kind: string, observed: Readonly<Record<string, string | number | boolean>>): void { this.events.push({ kind, observed }); }

  async startNoBlock(unitName: string): Promise<void> {
    this.event('start-no-block', { unitName });
    if (this.scenario === 'start-failure') throw new Error('injected start failure');
    await mkdir(this.invocationPath, { mode: 0o2770 });
    this.event('directory-created', { relativePath: this.attemptId, mode: 0o2770 });
  }

  async show(): Promise<SubscriptionUnitState> {
    this.shows += 1;
    this.event('unit-state', { sequence: this.shows });
    if (this.shows === 2) {
      const text = await readFile(join(this.invocationPath, 'request.json'), 'utf8');
      const request = SubscriptionRequestEnvelopeSchema.parse(JSON.parse(text));
      const info = await lstat(join(this.invocationPath, 'request.json'));
      if (request.attemptId !== this.attemptId || request.adapter !== this.adapter) throw new TypeError('Observed request identity drift.');
      this.requestEvidence = { relativePath: `${this.attemptId}/request.json`, adapter: request.adapter, attemptId: request.attemptId, size: Buffer.byteLength(text), sha256: sha256(text), expectedMode: 0o640, observedMode: info.mode & 0o777, atomic: true };
      if (this.handoffRoot !== undefined) await publishHandoff(this.handoffRoot, 'request', text);
      this.event('request-observed', { adapter: request.adapter, attemptId: request.attemptId });
    }
    if (this.scenario === 'missing-ready' && this.shows >= 2) return state({ activeState: 'failed', subState: 'failed' });
    if (this.scenario === 'status-before-ready' && this.shows === 2) return state({ statusText: 'result-published' });
    if (this.scenario === 'result-before-ready' && this.shows === 2) { await this.publishResult(); return state({ statusText: 'result-published' }); }
    if (this.shows === 1) return state();
    if (this.shows === 2) { this.event('ready-observed', { activeState: 'active', subState: 'running', statusText: '' }); return state({ activeState: 'active', subState: 'running' }); }
    await this.publishResult();
    this.event('result-status-observed', { activeState: 'active', subState: 'running', statusText: 'result-published' });
    return state({ activeState: 'active', subState: 'running', statusText: 'result-published' });
  }

  private async publishResult(): Promise<void> {
    if (this.scenario === 'non-atomic-result') { await writeFile(join(this.invocationPath, 'result.json'), '{', { flag: 'wx', mode: 0o640 }); return; }
    const directory = await verifyInvocationDirectory({ directoryPath: this.invocationPath, expectedRoot: this.root, instanceId: this.attemptId, expectedMode: 0o2770 });
    try {
      await writeAtomicIpcJson({ directory, temporaryName: 'result.tmp', finalName: 'result.json', value: { version: 1, adapter: this.adapter, attemptId: this.attemptId, outcome: 'success', rawOutput: this.scenario === 'wrong-result-digest' ? 'changed' : '{"ok":true}', clientExit: { code: 0, signal: null } }, schema: SubscriptionResultEnvelopeSchema, maximumBytes: IPC_LIMITS.result, mode: 0o640 });
      const text = await readFile(join(this.invocationPath, 'result.json'), 'utf8');
      const result = SubscriptionResultEnvelopeSchema.parse(JSON.parse(text));
      const info = await lstat(join(this.invocationPath, 'result.json'));
      this.resultEvidence = { relativePath: `${this.attemptId}/result.json`, adapter: result.adapter, attemptId: result.attemptId, size: Buffer.byteLength(text), sha256: sha256(text), expectedMode: 0o640, observedMode: info.mode & 0o777, atomic: true, rawOutputSha256: sha256(result.rawOutput) };
      if (this.handoffRoot !== undefined) await publishHandoff(this.handoffRoot, 'result', text);
      this.event('result-atomically-published', { adapter: result.adapter, attemptId: result.attemptId });
    } finally { await directory.close(); }
  }

  async stop(): Promise<void> { this.event('explicit-stop', { requested: true }); if (this.scenario === 'stop-failure') throw new Error('injected stop failure'); }
  async killAll(): Promise<void> { this.event('kill-all', { requested: true }); }
  async waitTerminal(): Promise<void> { this.event('terminal-observed', { terminal: true }); if (this.scenario !== 'cleanup-residue') await rm(this.invocationPath, { recursive: true, force: true }); this.event('exec-stop-post-observed', { invocationAbsent: this.scenario !== 'cleanup-residue' }); }
  async isCgroupEmpty(): Promise<boolean> { const empty = this.scenario !== 'cgroup-not-empty'; this.event('cgroup-observed', { empty }); return empty; }
}

const GC_MATRIX = [
  { activeState: 'active', ageMinutes: 30, decision: 'retain' },
  { activeState: 'inactive', ageMinutes: 5, decision: 'retain' },
  { activeState: 'unknown', ageMinutes: 30, decision: 'retain' },
  { activeState: 'inactive', ageMinutes: 11, decision: 'remove' }
] as const;
const keysEqual = (value: object, keys: readonly string[]): boolean => JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
function expectedEvents(adapter: SubscriptionAdapter, attemptId: string): readonly EvidenceEvent[] {
  return [
    { kind: 'start-no-block', observed: { unitName: `amazon-research-${adapter}@${attemptId}.service` } },
    { kind: 'directory-created', observed: { relativePath: attemptId, mode: 0o2770 } },
    { kind: 'unit-state', observed: { sequence: 1 } }, { kind: 'unit-state', observed: { sequence: 2 } },
    { kind: 'request-observed', observed: { adapter, attemptId } },
    { kind: 'ready-observed', observed: { activeState: 'active', subState: 'running', statusText: '' } },
    { kind: 'unit-state', observed: { sequence: 3 } },
    { kind: 'result-atomically-published', observed: { adapter, attemptId } },
    { kind: 'result-status-observed', observed: { activeState: 'active', subState: 'running', statusText: 'result-published' } },
    { kind: 'explicit-stop', observed: { requested: true } }, { kind: 'kill-all', observed: { requested: true } },
    { kind: 'terminal-observed', observed: { terminal: true } },
    { kind: 'exec-stop-post-observed', observed: { invocationAbsent: true } },
    { kind: 'cgroup-observed', observed: { empty: true } }
  ];
}

function exactLocalEvidence(report: Readonly<Record<string, unknown>>): boolean {
  const events = report['events']; const gc = report['gc']; const request = report['request']; const result = report['result']; const cleanup = report['cleanup'];
  const adapter = report['adapter']; const attemptId = report['attemptId'];
  if ((adapter !== 'codex' && adapter !== 'grok') || typeof attemptId !== 'string' || JSON.stringify(events) !== JSON.stringify(expectedEvents(adapter, attemptId)) || JSON.stringify(gc) !== JSON.stringify(GC_MATRIX)) return false;
  if (!request || typeof request !== 'object' || !result || typeof result !== 'object' || !cleanup || typeof cleanup !== 'object') return false;
  if (!keysEqual(request, ['relativePath', 'adapter', 'attemptId', 'size', 'sha256', 'expectedMode', 'observedMode', 'atomic']) ||
      !keysEqual(result, ['relativePath', 'adapter', 'attemptId', 'size', 'sha256', 'expectedMode', 'observedMode', 'atomic', 'rawOutputSha256']) ||
      !keysEqual(cleanup, ['relativeRoot', 'absent'])) return false;
  if (!('adapter' in request) || !('attemptId' in request) || !('atomic' in request) || !('expectedMode' in request) || !('sha256' in request) || !('size' in request) ||
      !('adapter' in result) || !('attemptId' in result) || !('atomic' in result) || !('expectedMode' in result) || !('sha256' in result) || !('size' in result) || !('rawOutputSha256' in result) ||
      !('relativeRoot' in cleanup) || !('absent' in cleanup)) return false;
  return request.adapter === adapter && result.adapter === adapter && request.attemptId === attemptId && result.attemptId === attemptId &&
    request.atomic === true && result.atomic === true && request.expectedMode === 0o640 && result.expectedMode === 0o640 && Number.isInteger(request.size) && Number.isInteger(result.size) &&
    typeof request.sha256 === 'string' && /^[0-9a-f]{64}$/u.test(request.sha256) && typeof result.sha256 === 'string' && /^[0-9a-f]{64}$/u.test(result.sha256) &&
    result.rawOutputSha256 === sha256('{"ok":true}') && cleanup.relativeRoot === attemptId && cleanup.absent === true;
}

export async function runLocalSubscriptionEvidence(adapter: SubscriptionAdapter, scenario: LocalEvidenceScenario = 'success', handoffRoot?: string, parentInvocationRoot?: string) {
  const root = parentInvocationRoot ?? join(tmpdir(), `ara-task14-owner-${randomUUID()}`); const attemptId = randomUUID(); const invocationPath = join(root, attemptId);
  if (handoffRoot !== undefined && (!isAbsolute(handoffRoot) || resolve(handoffRoot) !== handoffRoot)) throw new TypeError('Parent handoff root rejected.');
  if (parentInvocationRoot !== undefined && (!isAbsolute(parentInvocationRoot) || resolve(parentInvocationRoot) !== parentInvocationRoot)) throw new TypeError('Parent invocation root rejected.');
  const controller = new LocalEvidenceController(scenario, invocationPath, root, adapter, attemptId, handoffRoot);
  const sandbox = new SystemdSubscriptionSandbox({ controller, pollIntervalMs: 1, requestHandoffTimeoutMs: 100, startupTimeoutMs: 100, executionTimeoutMs: 100, cleanupTimeoutMs: 100 });
  await mkdir(root, { mode: 0o750, recursive: true });
  try {
    await sandbox.run({ adapter, profileId: `${adapter}-subscription-v1`, unitTemplate: `amazon-research-${adapter}@.service`, invocationRoot: root }, { attemptId, modelId: adapter === 'codex' ? 'gpt-5.6' : 'fixture-grok', role: 'niche_normalization', locale: 'en', prompt: 'local disposable fixture', inputHash: '0'.repeat(64) }, new AbortController().signal);
    const gc = await Promise.all(GC_MATRIX.map(async ({ activeState, ageMinutes }) => ({ activeState, ageMinutes, decision: await observeGcDecision(activeState, ageMinutes) })));
    const cleanup = { relativeRoot: relative(root, invocationPath), absent: await lstat(invocationPath).then(() => false, () => true) };
    const evidence = { schemaVersion: 2, adapter, attemptId, profileId: `${adapter}-subscription-v1`, unitName: `amazon-research-${adapter}@${attemptId}.service`, provenance: 'task5-owner-executed-v2', events: controller.events, request: controller.requestEvidence, result: controller.resultEvidence, gc, cleanup, oracleHostVerified: false, liveProviderVerified: false };
    const ok = exactLocalEvidence(evidence);
    return { ...evidence, ok, localFixtureVerified: ok };
  } finally { if (parentInvocationRoot === undefined) await rm(root, { recursive: true, force: true }); }
}

async function main(): Promise<void> {
  const adapter = process.argv[2];
  const handoffRoot = process.argv[3];
  const invocationRoot = process.argv[4];
  if ((adapter !== 'codex' && adapter !== 'grok') || process.argv.length !== 5 || handoffRoot === undefined || invocationRoot === undefined) throw new TypeError('Closed local evidence arguments rejected.');
  process.stdout.write(`${JSON.stringify(await runLocalSubscriptionEvidence(adapter, 'success', handoffRoot, invocationRoot))}\n`);
}

if (process.argv[1]?.endsWith('subscription-local-evidence.ts')) {
  main().catch(() => { process.stdout.write('{"schemaVersion":1,"ok":false,"localFixtureVerified":false,"oracleHostVerified":false,"liveProviderVerified":false}\n'); process.exitCode = 1; });
}
