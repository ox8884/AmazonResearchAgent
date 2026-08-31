#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const MAX_REPORT_BYTES = 32 * 1024;
const MAX_FIXTURE_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const REQUIRED_ARTIFACTS = [
  'subscription-supervisor.mjs',
  'manage-invocation.sh',
  'amazon-research-subscription-gc.service',
  'amazon-research-subscription-gc.timer',
  '50-amazon-research-subscription.rules',
  'amazon-research-subscription.nft',
  'runtime-profile.json'
];
const EVENTS = [
  'attempt-authorized', 'start-no-block', 'directory-created', 'directory-verified',
  'pre-start-waiting-no-request', 'request-tmp-written', 'request-renamed',
  'pre-start-validated', 'main-started', 'sandbox-validated', 'ready',
  'provider-fixture-started', 'result-tmp-written', 'result-renamed',
  'result-read', 'explicit-stop', 'cgroup-empty', 'exec-stop-post', 'terminal'
];
const FAILURES = {
  cancellationBeforeDirectory: 'clean',
  cancellationBeforeRequest: 'clean',
  cancellationBeforeReady: 'clean',
  invalidRequest: 'rejected',
  handoffTimeout: 'rejected',
  startFailureBeforeDirectory: 'clean',
  startFailureAfterDirectory: 'clean',
  synchronousStartDeadlock: 'rejected',
  noReadyTimeout: 'rejected'
};
const OBSERVED_PROPERTIES = [
  'ActiveState', 'SubState', 'StatusText', 'ExecMainCode', 'ExecMainStatus', 'Result'
];
const INSTALLED_PATHS = Object.freeze({
  'subscription-supervisor.mjs': '/usr/local/libexec/amazon-research/subscription-supervisor.mjs',
  'manage-invocation.sh': '/usr/local/libexec/amazon-research/manage-invocation.sh',
  'amazon-research-subscription-gc.service': '/etc/systemd/system/amazon-research-subscription-gc.service',
  'amazon-research-subscription-gc.timer': '/etc/systemd/system/amazon-research-subscription-gc.timer',
  '50-amazon-research-subscription.rules': '/etc/polkit-1/rules.d/50-amazon-research-subscription.rules',
  'amazon-research-subscription.nft': '/etc/nftables.d/amazon-research-subscription.nft'
});

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exact(values, expected) {
  return Array.isArray(values) && values.length === expected.length &&
    [...values].sort().every((value, index) => value === [...expected].sort()[index]);
}

function pathFor(adapter, attemptId, fileName = '') {
  const suffix = fileName === '' ? '' : `/${fileName}`;
  return `/run/amazon-research/subscription/${adapter}/${attemptId}${suffix}`;
}

function artifactNameMatches(name, expected) {
  return expected === 'runtime-profile.json'
    ? name.endsWith('-runtime-profile.json') || name === expected
    : name === expected;
}

function check(category, ok) {
  return Object.freeze({ category, ok: Boolean(ok) });
}

function hostCapability(f) {
  return f.host?.ubuntuRelease === '24.04' && Number.isInteger(f.host?.systemdVersion) &&
    f.host.systemdVersion >= 255 && f.host.unifiedCgroupV2 === true &&
    f.host.nftablesAvailable === true && f.host.polkitAvailable === true;
}

function identities(f) {
  const i = f.identities;
  if (!object(i)) return false;
  const worker = i.worker;
  const codex = i.codex;
  const grok = i.grok;
  const numeric = [worker, codex, grok].every((identity) => object(identity) &&
    Number.isInteger(identity.uid) && identity.uid >= 0 && Number.isInteger(identity.gid) && identity.gid >= 0);
  return numeric && new Set([worker.uid, codex.uid, grok.uid]).size === 3 &&
    worker.loginShell === '/usr/sbin/nologin' && codex.loginShell === '/usr/sbin/nologin' &&
    grok.loginShell === '/usr/sbin/nologin' &&
    exact(worker.groups, ['amazon-research', 'ara-codex-ipc', 'ara-grok-ipc']) &&
    exact(codex.groups, ['ara-codex', 'ara-codex-ipc']) &&
    exact(grok.groups, ['ara-grok', 'ara-grok-ipc']);
}

function authHomes(f) {
  const codex = f.authHomes?.codex;
  const grok = f.authHomes?.grok;
  return object(codex) && object(grok) && codex.path !== grok.path &&
    codex.path === '/var/lib/amazon-research/subscription/codex' &&
    grok.path === '/var/lib/amazon-research/subscription/grok' &&
    codex.uid === f.identities?.codex?.uid && codex.gid === f.identities?.codex?.gid &&
    grok.uid === f.identities?.grok?.uid && grok.gid === f.identities?.grok?.gid &&
    codex.mode === 0o700 && grok.mode === 0o700 &&
    codex.symlink === false && grok.symlink === false;
}

function protocolObject(value, expected) {
  return object(value) && value.path === expected.path && value.uid === expected.uid &&
    value.gid === expected.gid && value.mode === expected.mode &&
    value[expected.type] === true && value.symlink === false;
}

function ipc(f) {
  const adapter = f.adapter;
  const id = f.attemptId;
  const group = adapter === 'codex' ? 601 : 602;
  const adapterUid = f.identities?.[adapter]?.uid;
  const data = f.ipc;
  const parent = protocolObject(data?.parent, {
    path: `/run/amazon-research/subscription/${adapter}`, uid: 0, gid: group,
    mode: 0o750, type: 'regularDirectory'
  });
  const invocation = protocolObject(data?.invocation, {
    path: pathFor(adapter, id), uid: f.identities?.worker?.uid, gid: group,
    mode: 0o2770, type: 'regularDirectory'
  });
  const request = protocolObject(data?.request, {
    path: pathFor(adapter, id, 'request.json'), uid: f.identities?.worker?.uid,
    gid: group, mode: 0o640, type: 'regularFile'
  });
  const result = protocolObject(data?.result, {
    path: pathFor(adapter, id, 'result.json'), uid: adapterUid,
    gid: group, mode: 0o640, type: 'regularFile'
  });
  return parent && invocation && request && result && data.crossAdapterDenied === true &&
    data.request.size >= 0 && data.request.size <= 256 * 1024 && SHA256.test(data.request.sha256 ?? '') &&
    data.result.size >= 0 && data.result.size <= 2 * 1024 * 1024 && SHA256.test(data.result.sha256 ?? '') &&
    data.request.publishedByRename === true && data.request.temporaryRemoved === true &&
    data.result.publishedByRename === true && data.result.temporaryRemoved === true;
}

function artifacts(f) {
  if (!Array.isArray(f.artifacts)) return false;
  const required = [...REQUIRED_ARTIFACTS, `amazon-research-${f.adapter}@.service`];
  const expectedPath = (artifact) => {
    if (artifact.name.endsWith('-runtime-profile.json') || artifact.name === 'runtime-profile.json') {
      return `/etc/amazon-research/subscription/${f.adapter}-runtime-profile.json`;
    }
    if (artifact.name === `amazon-research-${f.adapter}@.service`) {
      return `/etc/systemd/system/${artifact.name}`;
    }
    return INSTALLED_PATHS[artifact.name];
  };
  return required.every((expected) => f.artifacts.some((artifact) => artifactNameMatches(artifact.name, expected))) &&
    f.artifacts.every((artifact) => object(artifact) && artifact.installedPath === expectedPath(artifact) &&
      artifact.repositoryRelativeInstalledPath === false && artifact.regularFile === true &&
      artifact.symlink === false && artifact.mutable === false && artifact.ownerUid === 0 &&
      artifact.ownerGid === 0 && [0o444, 0o500].includes(artifact.mode) &&
      SHA256.test(artifact.sourceSha256 ?? '') && artifact.sourceSha256 === artifact.installedSha256);
}

function fixedUnit(f) {
  const u = f.unit;
  const adapter = f.adapter;
  const id = f.attemptId;
  return object(u) && u.name === `amazon-research-${adapter}@${id}.service` &&
    u.type === 'notify' && u.notifyAccess === 'main' &&
    u.execStartPre === `/usr/local/libexec/amazon-research/manage-invocation.sh prepare-and-wait ${adapter} ${id}` &&
    u.execStart === `/usr/bin/node /usr/local/libexec/amazon-research/subscription-supervisor.mjs ${adapter} ${id}` &&
    u.execStopPost === `/usr/local/libexec/amazon-research/manage-invocation.sh cleanup ${adapter} ${id}` &&
    u.timeoutStartSec === 20 && u.requestHandoffSec === 5 && u.executionSec === 120 &&
    u.timeoutStopSec === 15 && u.killMode === 'control-group' &&
    exact(u.propertiesObserved, OBSERVED_PROPERTIES);
}

function lifecycle(f) {
  const value = f.lifecycle;
  return object(value) && exact(value.events, EVENTS) &&
    EVENTS.every((event, index) => value.events[index] === event) &&
    value.mainAbsentWithoutRequest === true && value.statusWithoutReadyRejected === true &&
    value.terminalOnlyAfterStop === true;
}

function failureMatrix(f) {
  const value = f.lifecycle?.failureMatrix;
  return object(value) && Object.entries(FAILURES).every(([name, outcome]) => value[name] === outcome);
}

function containment(f) {
  const c = f.containment;
  return object(c) && c.environmentAllowlistOnly === true && c.journalContainsSecrets === false &&
    [
      'productionReadDenied', 'workerEnvReadDenied', 'unrelatedHomeReadDenied', 'sshReadDenied',
      'hermesReadDenied', 'externalWriteDenied', 'shellExecDenied', 'subprocessExecDenied',
      'arbitraryNetworkDenied', 'inheritedConfigDenied', 'hooksDenied', 'mcpDenied',
      'sessionReuseDenied', 'memoryPersistenceDenied', 'providerOverrideDenied'
    ].every((key) => c[key] === true);
}

function network(f) {
  const n = f.network;
  return object(n) && n.resolverOnlyDns === true && n.acceptedHttpsPrefixesOnly === true &&
    n.otherEgressRejected === true && n.bindingDigestMatches === true;
}

function gc(f) {
  const g = f.gc;
  return object(g) && g.activeRefused === true && g.recentRefused === true &&
    g.ambiguousRefused === true && g.agedInactiveRemoved === true;
}

function writerFence(f) {
  const w = f.writerFence;
  return object(w) && w.phaseAIdentityMatches === true && w.sharedLockVerified === true &&
    w.timerDisabled === true && w.workerStopped === true && w.leasesSettled === true &&
    w.exclusiveLockVerified === true && w.migration022Defects === 0 &&
    w.canonicalCapabilityRows === 1 && w.wrongModeRejected === true &&
    w.phaseBIdentityMatches === true;
}

export function runLocalFixtureProbe(fixture) {
  const validEnvelope = object(fixture) && fixture.schemaVersion === 1 &&
    fixture.mode === 'local-fixture' && ['codex', 'grok'].includes(fixture.adapter) &&
    UUID.test(fixture.attemptId ?? '');
  const checks = [
    check('fixture-envelope', validEnvelope),
    check('host-capability', validEnvelope && hostCapability(fixture)),
    check('identity', validEnvelope && identities(fixture)),
    check('auth-home', validEnvelope && authHomes(fixture)),
    check('ipc', validEnvelope && ipc(fixture)),
    check('artifact', validEnvelope && artifacts(fixture)),
    check('unit', validEnvelope && fixedUnit(fixture)),
    check('lifecycle', validEnvelope && lifecycle(fixture)),
    check('failure-matrix', validEnvelope && failureMatrix(fixture)),
    check('containment', validEnvelope && containment(fixture)),
    check('network', validEnvelope && network(fixture)),
    check('gc', validEnvelope && gc(fixture)),
    check('writer-fence', validEnvelope && writerFence(fixture)),
    check('safety-boundary', validEnvelope && fixture.sanitized === true &&
      fixture.liveProviderCalled === false && fixture.productionMutated === false)
  ];
  return Object.freeze({
    schemaVersion: 1,
    ok: checks.every(({ ok }) => ok),
    mode: 'local-fixture',
    adapter: validEnvelope ? fixture.adapter : null,
    checks,
    oracleHostVerified: false,
    liveProviderVerified: false
  });
}

function usageError() {
  throw new TypeError('Usage: probe-subscription-provider.mjs --mode local-fixture --fixture <absolute-json-path>');
}

async function readFixture(path) {
  if (typeof path !== 'string' || path.length === 0) usageError();
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_FIXTURE_BYTES) throw new RangeError('Fixture exceeds fixed size limit.');
  return JSON.parse(bytes.toString('utf8'));
}

function parseArguments(argv) {
  if (argv.length !== 4 || argv[0] !== '--mode' || argv[1] !== 'local-fixture' || argv[2] !== '--fixture') {
    usageError();
  }
  return argv[3];
}

function boundedJson(report) {
  const output = `${JSON.stringify(report)}\n`;
  if (Buffer.byteLength(output) > MAX_REPORT_BYTES) {
    throw new RangeError('Sanitized report exceeds fixed size limit.');
  }
  return output;
}

async function cli() {
  const fixturePath = parseArguments(process.argv.slice(2));
  const report = runLocalFixtureProbe(await readFixture(fixturePath));
  process.stdout.write(boundedJson(report));
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await cli();
  } catch {
    const report = {
      schemaVersion: 1,
      ok: false,
      mode: 'local-fixture',
      adapter: null,
      checks: [check('fixture-envelope', false)],
      oracleHostVerified: false,
      liveProviderVerified: false
    };
    process.stdout.write(boundedJson(report));
    process.exitCode = 1;
  }
}
