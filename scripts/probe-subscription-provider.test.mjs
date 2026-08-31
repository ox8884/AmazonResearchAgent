import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  MAX_REPORT_BYTES,
  canonicalizeEndpointAuthority,
  renderEndpointPolicy,
  runDerivedLocalProbe,
  runLocalFixtureProbe
} from './probe-subscription-provider.mjs';

const fixtureAuthority = () => ({
  schemaVersion: 1,
  fixtureOnly: true,
  review: {
    identity: 'task14-local-fixture',
    version: '1',
    bindingsSha256: 'pending'
  },
  resolvers: {
    ipv4: ['192.0.2.53'],
    ipv6: ['2001:db8::53']
  },
  adapters: {
    codex: {
      provider: { ipv4: ['198.51.100.0/24'], ipv6: ['2001:db8:1::/48'] },
      auth: { ipv4: ['203.0.113.0/24'], ipv6: ['2001:db8:2::/48'] }
    },
    grok: {
      provider: { ipv4: ['198.51.100.0/24'], ipv6: ['2001:db8:3::/48'] },
      auth: { ipv4: ['203.0.113.0/24'], ipv6: ['2001:db8:4::/48'] }
    }
  }
});

function reviewedFixtureAuthority() {
  const authority = fixtureAuthority();
  const first = canonicalizeEndpointAuthority(authority, { environment: 'local-fixture', verifyDigest: false });
  authority.review.bindingsSha256 = first.bindingsSha256;
  return authority;
}

describe('endpoint binding authority', () => {
  it('renders nonempty deterministic adapter-specific nft sets', () => {
    const authority = reviewedFixtureAuthority();
    const canonical = canonicalizeEndpointAuthority(authority, { environment: 'local-fixture' });
    const rendered = renderEndpointPolicy(canonical);
    assert.match(rendered.text, /elements = \{ 192\.0\.2\.53 \}/u);
    assert.match(rendered.text, /codex_https_v4[^\n]*elements = \{ 198\.51\.100\.0\/24, 203\.0\.113\.0\/24 \}/u);
    assert.equal(rendered.text.includes('elements = {  }'), false);
    assert.match(rendered.sha256, /^[0-9a-f]{64}$/u);
  });

  for (const [name, mutate] of [
    ['empty resolver set', (a) => { a.resolvers.ipv4 = []; a.resolvers.ipv6 = []; }],
    ['missing adapter auth endpoint', (a) => { a.adapters.codex.auth.ipv4 = []; a.adapters.codex.auth.ipv6 = []; }],
    ['IPv4 in IPv6 field', (a) => { a.resolvers.ipv6 = ['192.0.2.1']; }],
    ['host bits in prefix', (a) => { a.adapters.codex.provider.ipv4 = ['198.51.100.1/24']; }],
    ['noncanonical duplicate', (a) => { a.adapters.codex.provider.ipv4.push('198.51.100.0/24'); }],
    ['loopback address', (a) => { a.resolvers.ipv4 = ['127.0.0.1']; }],
    ['metadata address', (a) => { a.resolvers.ipv4 = ['169.254.169.254']; }],
    ['unknown adapter', (a) => { a.adapters.evil = a.adapters.codex; }],
    ['shell injection', (a) => { a.resolvers.ipv4 = ['192.0.2.1; flush ruleset']; }],
    ['unreviewed prefix injection', (a) => { a.adapters.codex.provider.ipv4 = ['198.51.100.0/25']; }],
    ['unspecified address', (a) => { a.fixtureOnly = false; a.resolvers.ipv4 = ['0.0.0.0']; }],
    ['private address', (a) => { a.fixtureOnly = false; a.resolvers.ipv4 = ['10.0.0.1']; }],
    ['multicast address', (a) => { a.fixtureOnly = false; a.resolvers.ipv4 = ['239.1.1.1']; }],
    ['link-local address', (a) => { a.fixtureOnly = false; a.resolvers.ipv6 = ['fe80::1']; }],
    ['Tailscale address', (a) => { a.fixtureOnly = false; a.resolvers.ipv4 = ['100.100.100.100']; }]
  ]) {
    it(`rejects ${name}`, () => {
      const authority = reviewedFixtureAuthority();
      mutate(authority);
      assert.throws(() => canonicalizeEndpointAuthority(authority, { environment: 'local-fixture' }));
    });
  }

  it('refuses fixture-only bindings in Oracle mode', () => {
    assert.throws(() => canonicalizeEndpointAuthority(reviewedFixtureAuthority(), { environment: 'oracle' }));
  });

  it('canonical ordering produces the same authority and policy digest', () => {
    const left = reviewedFixtureAuthority();
    left.adapters.codex.provider.ipv4 = ['203.0.113.0/24', '198.51.100.0/24'];
    const unsigned = canonicalizeEndpointAuthority(left, { environment: 'local-fixture', verifyDigest: false });
    left.review.bindingsSha256 = unsigned.bindingsSha256;
    const right = structuredClone(left);
    right.adapters.codex.provider.ipv4.reverse();
    const a = canonicalizeEndpointAuthority(left, { environment: 'local-fixture' });
    const b = canonicalizeEndpointAuthority(right, { environment: 'local-fixture' });
    assert.equal(a.bindingsSha256, b.bindingsSha256);
    assert.equal(renderEndpointPolicy(a).sha256, renderEndpointPolicy(b).sha256);
  });
});
describe('installer full preflight', () => {
  it('leaves every target absent when the final unit is malformed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ara-task14-installer-'));
    roots.push(root);
    const repository = join(root, 'repo');
    const installRoot = join(root, 'target');
    const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
    const files = [
      'scripts/probe-subscription-provider.mjs',
      'ops/subscription-providers/endpoint-bindings.json',
      'ops/subscription-providers/subscription-supervisor.mjs',
      'ops/subscription-providers/manage-invocation.sh',
      'ops/systemd/amazon-research-codex@.service',
      'ops/systemd/amazon-research-grok@.service',
      'ops/systemd/amazon-research-subscription-gc.service',
      'ops/systemd/amazon-research-subscription-gc.timer',
      'ops/polkit/50-amazon-research-subscription.rules'
    ];
    for (const relative of files) {
      const target = join(repository, relative);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, await readFile(join(sourceRoot, relative)));
    }
    await writeFile(join(repository, 'ops/systemd/amazon-research-subscription-gc.timer'), '[Timer]\nBROKEN');
    await mkdir(join(installRoot, 'etc/amazon-research/subscription'), { recursive: true });
    await writeFile(
      join(installRoot, 'etc/amazon-research/subscription/endpoint-bindings.json'),
      await readFile(join(repository, 'ops/subscription-providers/endpoint-bindings.json'))
    );
    const installer = join(sourceRoot, 'ops/subscription-providers/install-systemd-sandbox.sh');
    const child = spawnSync('bash', [installer, 'install'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ARA_REPOSITORY_ROOT: repository,
        ARA_INSTALL_ROOT: installRoot,
        ARA_FIXTURE_MODE: '1'
      }
    });
    assert.notEqual(child.status, 0, child.stdout + child.stderr);
    await assert.rejects(stat(join(installRoot, 'usr/local/libexec/amazon-research/subscription-supervisor.mjs')), { code: 'ENOENT' });
    await assert.rejects(stat(join(installRoot, 'etc/systemd/system/amazon-research-codex@.service')), { code: 'ENOENT' });
    await assert.rejects(stat(join(installRoot, 'etc/nftables.d/amazon-research-subscription.nft')), { code: 'ENOENT' });
  });

  it('leaves targets absent when endpoint authority rendering fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ara-task14-authority-'));
    roots.push(root);
    const installRoot = join(root, 'target');
    await mkdir(join(installRoot, 'etc/amazon-research/subscription'), { recursive: true });
    const authority = reviewedFixtureAuthority();
    authority.adapters.grok.auth.ipv4 = [];
    await writeFile(join(installRoot, 'etc/amazon-research/subscription/endpoint-bindings.json'), JSON.stringify(authority));
    const installer = fileURLToPath(new URL('../ops/subscription-providers/install-systemd-sandbox.sh', import.meta.url));
    const repository = fileURLToPath(new URL('..', import.meta.url));
    const child = spawnSync('bash', [installer, 'install'], {
      encoding: 'utf8',
      env: { ...process.env, ARA_REPOSITORY_ROOT: repository, ARA_INSTALL_ROOT: installRoot, ARA_FIXTURE_MODE: '1' }
    });
    assert.notEqual(child.status, 0);
    await assert.rejects(stat(join(installRoot, 'etc/systemd/system/amazon-research-codex@.service')), { code: 'ENOENT' });
  });
});
const roots = [];
const attemptId = '00000000-0000-4000-8000-000000000001';
const operations = [
  'attempt-authorized', 'start-no-block', 'directory-created', 'directory-verified',
  'pre-start-waiting-no-request', 'request-tmp-written', 'request-renamed',
  'pre-start-validated', 'main-started', 'sandbox-validated', 'ready',
  'provider-fixture-started', 'result-tmp-written', 'result-renamed',
  'result-read', 'explicit-stop', 'cgroup-empty', 'exec-stop-post', 'terminal'
];
const gcStates = [
  { activeState: 'active', ageMinutes: 30, expected: 'refuse' },
  { activeState: 'inactive', ageMinutes: 5, expected: 'refuse' },
  { activeState: 'unknown', ageMinutes: 30, expected: 'refuse' },
  { activeState: 'inactive', ageMinutes: 11, expected: 'remove' }
];

function runner(command, args) {
  const child = spawnSync(command, args, { encoding: 'utf8' });
  return Promise.resolve({ exitCode: child.status ?? 1 });
}

function derivedInput(overrides = {}) {
  return {
    adapter: 'codex',
    attemptId,
    repositoryRoot: fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/'),
    operations: [...operations],
    gcStates: structuredClone(gcStates),
    runner,
    ...overrides
  };
}
function categories(result) {
  return result.checks.filter((check) => !check.ok).map((check) => check.category);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('subscription provider derived local probe', () => {
  it('derives acceptance from fixed files, commands, lifecycle operations, and GC states', async () => {
    const result = await runDerivedLocalProbe(derivedInput());
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.localFixtureVerified, true);
    assert.equal(result.oracleHostVerified, false);
    assert.equal(result.liveProviderVerified, false);
    assert.equal(result.evidence.provenance, 'derived-local-v1');
    assert.match(result.evidence.renderedPolicySha256, /^[0-9a-f]{64}$/u);
    assert.deepEqual(result.evidence.lifecycleEvents, operations);
  });

  it('rejects the former fabricated all-true fixture', () => {
    const result = runLocalFixtureProbe({ allClaims: true, ok: true, oracleHostVerified: true });
    assert.equal(result.ok, false);
    assert.equal(result.localFixtureVerified, false);
    assert.equal(result.oracleHostVerified, false);
    assert.ok(categories(result).includes('self-attested-fixture-rejected'));
  });

  for (const [name, mutate] of [
    ['missing READY', (value) => value.filter((event) => event !== 'ready')],
    ['duplicate READY', (value) => [...value.slice(0, 11), 'ready', ...value.slice(11)]],
    ['reordered READY', (value) => { const copy = [...value]; [copy[10], copy[11]] = [copy[11], copy[10]]; return copy; }],
    ['result before READY', (value) => { const copy = [...value]; const result = copy.splice(copy.indexOf('result-read'), 1)[0]; copy.splice(9, 0, result); return copy; }],
    ['no explicit stop', (value) => value.filter((event) => event !== 'explicit-stop')],
    ['ExecStopPost before cgroup empty', (value) => { const copy = [...value]; const a = copy.indexOf('cgroup-empty'); const b = copy.indexOf('exec-stop-post'); [copy[a], copy[b]] = [copy[b], copy[a]]; return copy; }]
  ]) {
    it(`fails for ${name}`, async () => {
      const result = await runDerivedLocalProbe(derivedInput({ operations: mutate(operations) }));
      assert.equal(result.ok, false);
      assert.ok(categories(result).includes('lifecycle'));
    });
  }

  for (const [name, index, expected] of [
    ['active GC removal', 0, 'remove'],
    ['recent GC removal', 1, 'remove'],
    ['ambiguous GC removal', 2, 'remove'],
    ['aged inactive GC refusal', 3, 'refuse']
  ]) {
    it(`fails for ${name}`, async () => {
      const states = structuredClone(gcStates);
      states[index].expected = expected;
      const result = await runDerivedLocalProbe(derivedInput({ gcStates: states }));
      assert.equal(result.ok, false);
      assert.ok(categories(result).includes('gc'));
    });
  }

  it('fails when a fixed command reports nonzero', async () => {
    const result = await runDerivedLocalProbe(derivedInput({
      runner: async () => ({ exitCode: 1 })
    }));
    assert.equal(result.ok, false);
    assert.ok(categories(result).includes('fixed-command-plan'));
  });

  it('emits bounded sanitized JSON and exits nonzero for self-attested input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ara-task14-probe-'));
    roots.push(root);
    const fixturePath = join(root, 'fixture.json');
    await writeFile(fixturePath, JSON.stringify({ allClaims: true, oracleHostVerified: true }));
    const child = spawnSync(process.execPath, [
      fileURLToPath(new URL('./probe-subscription-provider.mjs', import.meta.url)),
      '--mode', 'local-fixture', '--fixture', fixturePath
    ], { encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    assert.ok(Buffer.byteLength(child.stdout) <= MAX_REPORT_BYTES);
    const report = JSON.parse(child.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.oracleHostVerified, false);
  });
});
