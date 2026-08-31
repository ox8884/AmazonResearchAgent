import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  MAX_REPORT_BYTES,
  runLocalFixtureProbe
} from './probe-subscription-provider.mjs';

const roots = [];
const digest = (value) => value.repeat(64);

function validFixture() {
  const attemptId = '00000000-0000-4000-8000-000000000001';
  const installedPaths = {
    'subscription-supervisor.mjs': '/usr/local/libexec/amazon-research/subscription-supervisor.mjs',
    'manage-invocation.sh': '/usr/local/libexec/amazon-research/manage-invocation.sh',
    'amazon-research-subscription-gc.service': '/etc/systemd/system/amazon-research-subscription-gc.service',
    'amazon-research-subscription-gc.timer': '/etc/systemd/system/amazon-research-subscription-gc.timer',
    'amazon-research-codex@.service': '/etc/systemd/system/amazon-research-codex@.service',
    '50-amazon-research-subscription.rules': '/etc/polkit-1/rules.d/50-amazon-research-subscription.rules',
    'amazon-research-subscription.nft': '/etc/nftables.d/amazon-research-subscription.nft',
    'codex-runtime-profile.json': '/etc/amazon-research/subscription/codex-runtime-profile.json'
  };
  const artifacts = Object.entries(installedPaths).map(([name, installedPath], index) => ({
    name,
    sourcePath: `C:/repo/ops/${name}`,
    installedPath,
    sourceSha256: digest(String((index % 9) + 1)),
    installedSha256: digest(String((index % 9) + 1)),
    ownerUid: 0,
    ownerGid: 0,
    mode: name.endsWith('.sh') || name.endsWith('.mjs') ? 0o500 : 0o444,
    regularFile: true,
    symlink: false,
    mutable: false,
    repositoryRelativeInstalledPath: false
  }));
  return {
    schemaVersion: 1,
    mode: 'local-fixture',
    adapter: 'codex',
    attemptId,
    host: {
      ubuntuRelease: '24.04',
      systemdVersion: 255,
      unifiedCgroupV2: true,
      nftablesAvailable: true,
      polkitAvailable: true
    },
    identities: {
      worker: { name: 'amazon-research', uid: 500, gid: 500, loginShell: '/usr/sbin/nologin', groups: ['amazon-research', 'ara-codex-ipc', 'ara-grok-ipc'] },
      codex: { name: 'ara-codex', uid: 501, gid: 501, loginShell: '/usr/sbin/nologin', groups: ['ara-codex', 'ara-codex-ipc'] },
      grok: { name: 'ara-grok', uid: 502, gid: 502, loginShell: '/usr/sbin/nologin', groups: ['ara-grok', 'ara-grok-ipc'] }
    },
    authHomes: {
      codex: { path: '/var/lib/amazon-research/subscription/codex', uid: 501, gid: 501, mode: 0o700, symlink: false },
      grok: { path: '/var/lib/amazon-research/subscription/grok', uid: 502, gid: 502, mode: 0o700, symlink: false }
    },
    ipc: {
      parent: { path: '/run/amazon-research/subscription/codex', uid: 0, gid: 601, mode: 0o750, regularDirectory: true, symlink: false },
      invocation: { path: `/run/amazon-research/subscription/codex/${attemptId}`, uid: 500, gid: 601, mode: 0o2770, regularDirectory: true, symlink: false },
      request: { path: `/run/amazon-research/subscription/codex/${attemptId}/request.json`, uid: 500, gid: 601, mode: 0o640, regularFile: true, symlink: false, size: 1024, sha256: digest('a'), publishedByRename: true, temporaryRemoved: true },
      result: { path: `/run/amazon-research/subscription/codex/${attemptId}/result.json`, uid: 501, gid: 601, mode: 0o640, regularFile: true, symlink: false, size: 2048, sha256: digest('b'), publishedByRename: true, temporaryRemoved: true },
      crossAdapterDenied: true
    },
    artifacts,
    unit: {
      name: `amazon-research-codex@${attemptId}.service`,
      type: 'notify',
      notifyAccess: 'main',
      execStartPre: `/usr/local/libexec/amazon-research/manage-invocation.sh prepare-and-wait codex ${attemptId}`,
      execStart: `/usr/bin/node /usr/local/libexec/amazon-research/subscription-supervisor.mjs codex ${attemptId}`,
      execStopPost: `/usr/local/libexec/amazon-research/manage-invocation.sh cleanup codex ${attemptId}`,
      timeoutStartSec: 20,
      requestHandoffSec: 5,
      executionSec: 120,
      timeoutStopSec: 15,
      killMode: 'control-group',
      propertiesObserved: ['ActiveState', 'SubState', 'StatusText', 'ExecMainCode', 'ExecMainStatus', 'Result']
    },
    lifecycle: {
      events: [
        'attempt-authorized', 'start-no-block', 'directory-created', 'directory-verified',
        'pre-start-waiting-no-request', 'request-tmp-written', 'request-renamed',
        'pre-start-validated', 'main-started', 'sandbox-validated', 'ready',
        'provider-fixture-started', 'result-tmp-written', 'result-renamed',
        'result-read', 'explicit-stop', 'cgroup-empty', 'exec-stop-post', 'terminal'
      ],
      mainAbsentWithoutRequest: true,
      statusWithoutReadyRejected: true,
      terminalOnlyAfterStop: true,
      failureMatrix: {
        cancellationBeforeDirectory: 'clean',
        cancellationBeforeRequest: 'clean',
        cancellationBeforeReady: 'clean',
        invalidRequest: 'rejected',
        handoffTimeout: 'rejected',
        startFailureBeforeDirectory: 'clean',
        startFailureAfterDirectory: 'clean',
        synchronousStartDeadlock: 'rejected',
        noReadyTimeout: 'rejected'
      }
    },
    containment: {
      environmentAllowlistOnly: true,
      journalContainsSecrets: false,
      productionReadDenied: true,
      workerEnvReadDenied: true,
      unrelatedHomeReadDenied: true,
      sshReadDenied: true,
      hermesReadDenied: true,
      externalWriteDenied: true,
      shellExecDenied: true,
      subprocessExecDenied: true,
      arbitraryNetworkDenied: true,
      inheritedConfigDenied: true,
      hooksDenied: true,
      mcpDenied: true,
      sessionReuseDenied: true,
      memoryPersistenceDenied: true,
      providerOverrideDenied: true
    },
    network: {
      resolverOnlyDns: true,
      acceptedHttpsPrefixesOnly: true,
      otherEgressRejected: true,
      bindingDigestMatches: true
    },
    gc: {
      activeRefused: true,
      recentRefused: true,
      ambiguousRefused: true,
      agedInactiveRemoved: true
    },
    writerFence: {
      phaseAIdentityMatches: true,
      sharedLockVerified: true,
      timerDisabled: true,
      workerStopped: true,
      leasesSettled: true,
      exclusiveLockVerified: true,
      migration022Defects: 0,
      canonicalCapabilityRows: 1,
      wrongModeRejected: true,
      phaseBIdentityMatches: true
    },
    sanitized: true,
    liveProviderCalled: false,
    productionMutated: false
  };
}

function clone(value) {
  return structuredClone(value);
}

function categories(result) {
  return result.checks.filter((check) => !check.ok).map((check) => check.category);
}

function expectFailure(mutator, expectedCategory) {
  const fixture = clone(validFixture());
  mutator(fixture);
  const result = runLocalFixtureProbe(fixture);
  assert.equal(result.ok, false);
  assert.ok(categories(result).includes(expectedCategory), JSON.stringify(result));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('subscription provider local fixture probe', () => {
  it('accepts the complete fixed Task-5 lifecycle and denial matrix', () => {
    const result = runLocalFixtureProbe(validFixture());
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.mode, 'local-fixture');
    assert.equal(result.oracleHostVerified, false);
    assert.equal(result.liveProviderVerified, false);
  });

  for (const [name, mutate, category] of [
    ['systemd below 255', (f) => { f.host.systemdVersion = 254; }, 'host-capability'],
    ['non-unified cgroup', (f) => { f.host.unifiedCgroupV2 = false; }, 'host-capability'],
    ['missing nftables', (f) => { f.host.nftablesAvailable = false; }, 'host-capability'],
    ['missing polkit', (f) => { f.host.polkitAvailable = false; }, 'host-capability'],
    ['wrong exact membership', (f) => { f.identities.codex.groups.push('ara-grok-ipc'); }, 'identity'],
    ['login-capable adapter identity', (f) => { f.identities.codex.loginShell = '/bin/bash'; }, 'identity'],
    ['shared auth home', (f) => { f.authHomes.grok.path = f.authHomes.codex.path; }, 'auth-home'],
    ['wrong auth mode', (f) => { f.authHomes.codex.mode = 0o750; }, 'auth-home'],
    ['wrong invocation owner', (f) => { f.ipc.invocation.uid = 0; }, 'ipc'],
    ['request symlink', (f) => { f.ipc.request.symlink = true; }, 'ipc'],
    ['oversized result', (f) => { f.ipc.result.size = 2 * 1024 * 1024 + 1; }, 'ipc'],
    ['non-atomic request', (f) => { f.ipc.request.publishedByRename = false; }, 'ipc'],
    ['cross-adapter IPC access', (f) => { f.ipc.crossAdapterDenied = false; }, 'ipc'],
    ['artifact digest drift', (f) => { f.artifacts[0].installedSha256 = digest('f'); }, 'artifact'],
    ['mutable artifact', (f) => { f.artifacts[0].mutable = true; }, 'artifact'],
    ['artifact symlink', (f) => { f.artifacts[0].symlink = true; }, 'artifact'],
    ['repo-relative installed artifact', (f) => { f.artifacts[0].repositoryRelativeInstalledPath = true; }, 'artifact'],
    ['synchronous start', (f) => { f.lifecycle.events[1] = 'start-blocking'; }, 'lifecycle'],
    ['MAIN before READY contract', (f) => { const a = f.lifecycle.events.indexOf('ready'); const b = f.lifecycle.events.indexOf('provider-fixture-started'); [f.lifecycle.events[a], f.lifecycle.events[b]] = [f.lifecycle.events[b], f.lifecycle.events[a]]; }, 'lifecycle'],
    ['STATUS substitutes for READY', (f) => { f.lifecycle.statusWithoutReadyRejected = false; }, 'lifecycle'],
    ['missing cancellation case', (f) => { delete f.lifecycle.failureMatrix.cancellationBeforeReady; }, 'failure-matrix'],
    ['unsafe active GC', (f) => { f.gc.activeRefused = false; }, 'gc'],
    ['resolver drift', (f) => { f.network.bindingDigestMatches = false; }, 'network'],
    ['environment leak', (f) => { f.containment.environmentAllowlistOnly = false; }, 'containment'],
    ['journal secret leak', (f) => { f.containment.journalContainsSecrets = true; }, 'containment'],
    ['filesystem escape', (f) => { f.containment.productionReadDenied = false; }, 'containment'],
    ['exec escape', (f) => { f.containment.shellExecDenied = false; }, 'containment'],
    ['network escape', (f) => { f.containment.arbitraryNetworkDenied = false; }, 'containment'],
    ['incomplete writer fence', (f) => { f.writerFence.workerStopped = false; }, 'writer-fence'],
    ['wrong writer artifact pairing', (f) => { f.writerFence.phaseBIdentityMatches = false; }, 'writer-fence'],
    ['live provider call in local mode', (f) => { f.liveProviderCalled = true; }, 'safety-boundary'],
    ['production mutation in local mode', (f) => { f.productionMutated = true; }, 'safety-boundary']
  ]) {
    it(`fails closed for ${name}`, () => expectFailure(mutate, category));
  }

  it('emits bounded sanitized JSON and exits nonzero for a missing category', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ara-task14-probe-'));
    roots.push(root);
    const fixturePath = join(root, 'fixture.json');
    const fixture = validFixture();
    fixture.containment.sshReadDenied = false;
    await writeFile(fixturePath, JSON.stringify(fixture));
    const child = spawnSync(process.execPath, [
      fileURLToPath(new URL('./probe-subscription-provider.mjs', import.meta.url)),
      '--mode', 'local-fixture', '--fixture', fixturePath
    ], { encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    assert.ok(Buffer.byteLength(child.stdout) <= MAX_REPORT_BYTES);
    const report = JSON.parse(child.stdout);
    assert.equal(report.ok, false);
    assert.ok(categories(report).includes('containment'));
    assert.equal(child.stdout.includes('fixture prompt'), false);
    assert.equal(child.stdout.includes('/home/'), false);
  });
});
