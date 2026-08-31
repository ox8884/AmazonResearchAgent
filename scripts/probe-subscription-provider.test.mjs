import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  MAX_REPORT_BYTES,
  canonicalizeEndpointAuthority,
  computeEndpointAuthorityDigest,
  renderEndpointPolicy,
  runDerivedLocalProbe,
  runLocalFixtureProbe
} from './probe-subscription-provider.mjs';
import { verifyInstalledAuthority } from './probe-subscription-provider.mjs';
import { assertActiveNftMatches, expectedNftRuleset } from './subscription-nft-semantics.mjs';

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
  const canonical = structuredClone(authority);
  canonical.adapters = Object.fromEntries(['codex', 'grok'].map((adapter) => [adapter, Object.fromEntries(['auth', 'provider'].map((group) => [group, {
    ipv4: [...canonical.adapters[adapter][group].ipv4].sort(), ipv6: [...canonical.adapters[adapter][group].ipv6].sort()
  }]))]));
  authority.review.bindingsSha256 = computeEndpointAuthorityDigest(canonical);
  return authority;
}
function productionAuthority(overrides = {}) {
  const now = new Date();
  const authority = {
    schemaVersion: 2,
    fixtureOnly: false,
    release: {
      commit: 'ce6a68bb08ece2a2ea1a986662523d024eddf3e7',
      profile: 'subscription-sandbox-v1'
    },
    review: {
      identity: 'amazon-research-network-security',
      version: 'task14-production-v1',
      reviewedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      bindingsSha256: 'pending'
    },
    resolvers: [{ hostname: 'resolver.example.test', resolvedAt: now.toISOString(), ttlSeconds: 3600, ipv4: ['8.8.8.8'], ipv6: ['2001:4860:4860::8888'] }],
    adapters: {
      codex: {
        provider: [{ hostname: 'api.codex.example.test', resolvedAt: now.toISOString(), ttlSeconds: 3600, ipv4: ['8.8.4.0/24'], ipv6: ['2606:4700:4700::/48'] }],
        auth: [{ hostname: 'auth.codex.example.test', resolvedAt: now.toISOString(), ttlSeconds: 3600, ipv4: ['1.1.1.0/24'], ipv6: ['2606:4700:100::/48'] }]
      },
      grok: {
        provider: [{ hostname: 'api.grok.example.test', resolvedAt: now.toISOString(), ttlSeconds: 3600, ipv4: ['9.9.9.0/24'], ipv6: ['2620:fe::/48'] }],
        auth: [{ hostname: 'auth.grok.example.test', resolvedAt: now.toISOString(), ttlSeconds: 3600, ipv4: ['149.112.112.0/24'], ipv6: ['2620:fe:fe::/48'] }]
      }
    },
    artifacts: Object.fromEntries([
      '/usr/local/libexec/amazon-research/subscription-supervisor.mjs',
      '/usr/local/libexec/amazon-research/manage-invocation.sh',
      '/etc/systemd/system/amazon-research-codex@.service',
      '/etc/systemd/system/amazon-research-grok@.service',
      '/etc/systemd/system/amazon-research-subscription-gc.service',
      '/usr/local/libexec/amazon-research/subscription-gc-decision.mjs',
      '/etc/systemd/system/amazon-research-subscription-gc.timer',
      '/etc/polkit-1/rules.d/50-amazon-research-subscription.rules',
      '/etc/nftables.d/amazon-research-subscription.nft'
    ].map((path) => [path, { sha256: 'a'.repeat(64), mode: path.includes('libexec') ? '0500' : '0444' }])),
    ...overrides
  };
  authority.review.bindingsSha256 = computeEndpointAuthorityDigest(authority);
  return authority;
}

describe('endpoint binding authority', () => {
  it('renders nonempty deterministic adapter-specific nft sets', async () => {
    const authority = reviewedFixtureAuthority();
    const root = fileURLToPath(new URL('..', import.meta.url));
    const fixture = join(root, `.task14-render-${process.pid}.json`);
    roots.push(fixture);
    await writeFile(fixture, JSON.stringify(authority));
    const child = spawnSync(process.execPath, [
      join(root, 'scripts/probe-subscription-provider.mjs'), '--mode', 'render-endpoint-policy',
      '--authority', fixture, '--environment', 'local-fixture'
    ], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stdout);
    assert.match(child.stdout, /elements = \{ 192\.0\.2\.53 \}/u);
    assert.match(child.stdout, /codex_https_v4[^\n]*elements = \{ 198\.51\.100\.0\/24, 203\.0\.113\.0\/24 \}/u);
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
    it(`rejects ${name}`, async () => {
      const authority = reviewedFixtureAuthority();
      mutate(authority);
      const root = fileURLToPath(new URL('..', import.meta.url));
      const fixture = join(root, `.task14-negative-${process.pid}-${name.replaceAll(' ', '-')}.json`);
      roots.push(fixture);
      await writeFile(fixture, JSON.stringify(authority));
      const child = spawnSync(process.execPath, [
        join(root, 'scripts/probe-subscription-provider.mjs'), '--mode', 'render-endpoint-policy',
        '--authority', fixture, '--environment', 'local-fixture'
      ], { encoding: 'utf8' });
      assert.notEqual(child.status, 0);
    });
  }

  it('refuses fixture-only bindings in Oracle mode', () => {
    assert.throws(() => canonicalizeEndpointAuthority(reviewedFixtureAuthority()));
  });

  it('fixture digest rejects noncanonical endpoint ordering until canonicalized', () => {
    const left = reviewedFixtureAuthority();
    left.adapters.codex.provider.ipv4 = ['203.0.113.0/24', '198.51.100.0/24'];
    assert.notEqual(computeEndpointAuthorityDigest(left), left.review.bindingsSha256);
  });
});

describe('production endpoint authority', () => {
  for (const [name, mutate, expected] of [
    ['IPv6 link-local fe80::/10', (a) => { a.resolvers[0].ipv6 = ['febf::1']; }, /range is not allowed/u],
    ['IPv6 ULA fc00::/7', (a) => { a.resolvers[0].ipv6 = ['fdff::1']; }, /range is not allowed/u],
    ['arbitrary prefix outside hostname review', (a) => { a.adapters.codex.provider[0].ipv4 = ['8.8.8.0/24']; }, /hostname prefix binding rejected/u],
    ['stale resolution', (a) => { a.resolvers[0].resolvedAt = '2026-08-31T09:00:00.000Z'; }, /resolution is stale/u],
    ['unapproved reviewer', (a) => { a.review.identity = 'self-authored'; }, /reviewer authority rejected/u],
    ['release mismatch', (a) => { a.release.commit = 'f'.repeat(40); }, /release\/profile binding rejected/u]
  ]) {
    it(`rejects valid-digest ${name}`, () => {
      const authority = productionAuthority();
      mutate(authority);
      authority.review.bindingsSha256 = computeEndpointAuthorityDigest(authority);
      assert.throws(() => canonicalizeEndpointAuthority(authority));
    });
  }
  it('rejects an otherwise-valid test authority in the actual Oracle environment', () => {
    const authority = productionAuthority();
    assert.throws(
      () => canonicalizeEndpointAuthority(authority),
      /No reviewed production hostname authority is published/u
    );
  });
});

describe('active nft semantic identity', () => {
  const expected = () => expectedNftRuleset(reviewedFixtureAuthority());
  const clone = () => structuredClone(expected());

  it('accepts the exact authority-derived ruleset', () => {
    assert.doesNotThrow(() => assertActiveNftMatches(expected(), clone()));
  });

  for (const [name, mutate] of [
    ['extra allow rule', (rules) => rules.nftables.push(structuredClone(rules.nftables.at(-2)))],

    ['missing final reject', (rules) => { rules.nftables.pop(); }],
    ['changed set prefix', (rules) => { rules.nftables.find((entry) => entry.set?.name === 'codex_https_v4').set.elem[0] = '198.51.100.0/25'; }],
    ['wrong UID', (rules) => { rules.nftables.find((entry) => entry.rule).rule.expr[0].match.right = 'ara-other'; }],
    ['wrong family', (rules) => { rules.nftables.find((entry) => entry.rule).rule.expr[1].match.left.payload.protocol = 'ip6'; }],
    ['wrong port', (rules) => { rules.nftables.find((entry) => entry.rule).rule.expr[2].match.right = 54; }],
    ['wrong hook', (rules) => { rules.nftables.find((entry) => entry.chain).chain.hook = 'input'; }],
    ['wrong priority', (rules) => { rules.nftables.find((entry) => entry.chain).chain.prio = 1; }],
    ['wrong policy', (rules) => { rules.nftables.find((entry) => entry.chain).chain.policy = 'drop'; }],
    ['unknown semantic object', (rules) => rules.nftables.push({ flowtable: {} })],
    ['truncated output', (rules) => { rules.nftables = rules.nftables.slice(0, 2); }]
  ]) {
    // Break: active rules drift while the installed policy remains approved.
    it(`rejects ${name}`, () => {
      const active = clone();
      mutate(active);
      assert.throws(() => assertActiveNftMatches(expected(), active));
    });
  }
  it('ignores nft presentation handles only', () => {
    const active = clone();
    for (const object of active.nftables) {
      const value = object.table ?? object.set ?? object.chain ?? object.rule;
      if (value !== undefined) value.handle = 99;
    }
    assert.doesNotThrow(() => assertActiveNftMatches(expected(), active));
  });

  it('rejects malformed active output', () => {
    assert.throws(() => assertActiveNftMatches(expected(), { nftables: 'truncated' }));
  });
});

describe('production import authority separation', () => {
  // Break: a production importer selects embedded fixture approval bindings.
  it('cannot select test approval bindings', () => {
    const authority = productionAuthority();
    assert.throws(
      () => canonicalizeEndpointAuthority(authority, {
        environment: 'oracle-fixture',
        now: new Date('2026-08-31T12:00:00.000Z')
      }),
      /production canonicalizer rejects options/u
    );
  });

  // Break: a production importer verifies an alternate installed root and owner.
  it('cannot inject an installed root or owner', async () => {
    const authority = productionAuthority();
    await assert.rejects(
      verifyInstalledAuthority(authority, { installedRoot: '.', expectedUid: process.getuid?.() ?? 0 }),
      /production installed verifier rejects options/u
    );
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

  it('rolls back every created file and parent after a late atomic publication failure', async () => {
    const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
    const root = await mkdtemp(join(sourceRoot, '.task14-rollback-'));
    roots.push(root);
    const installRoot = join(root, 'target');
    await mkdir(join(installRoot, 'etc/amazon-research/subscription'), { recursive: true });
    await writeFile(
      join(installRoot, 'etc/amazon-research/subscription/endpoint-bindings.json'),
      await readFile(join(sourceRoot, 'ops/subscription-providers/endpoint-bindings.json'))
    );
    const child = spawnSync('bash', [
      'ops/subscription-providers/install-systemd-sandbox.sh', 'install',
      '--fixture-root', `./${basename(root)}/target`, '--repository-root', '.',
      '--fail-at', 'publish-6'
    ], { cwd: sourceRoot, encoding: 'utf8' });
    assert.notEqual(child.status, 0, child.stdout + child.stderr);
    assert.match(child.stderr, /injected publication failure 6/u);
    for (const relative of [
      'usr/local/libexec/amazon-research/subscription-supervisor.mjs',
      'usr/local/libexec/amazon-research/manage-invocation.sh',
      'etc/systemd/system/amazon-research-codex@.service',
      'etc/polkit-1/rules.d/50-amazon-research-subscription.rules'
    ]) {
      await assert.rejects(stat(join(installRoot, relative)), { code: 'ENOENT' }, `rollback residue: ${relative}`);
    }
    await assert.rejects(stat(join(installRoot, 'usr/local/libexec')), { code: 'ENOENT' });
  });

  // Break: rollback ledgers a target before link publication and deletes the concurrent winner.
  it('preserves a competitor created immediately before atomic publication', async () => {
    const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
    const root = await mkdtemp(join(sourceRoot, '.task14-race-'));
    roots.push(root);
    const installRoot = join(root, 'target');
    await mkdir(join(installRoot, 'etc/amazon-research/subscription'), { recursive: true });
    await writeFile(
      join(installRoot, 'etc/amazon-research/subscription/endpoint-bindings.json'),
      await readFile(join(sourceRoot, 'ops/subscription-providers/endpoint-bindings.json'))
    );
    const child = spawnSync('bash', [
      'ops/subscription-providers/install-systemd-sandbox.sh', 'install',
      '--fixture-root', `./${basename(root)}/target`, '--repository-root', '.',
      '--race-at', 'publish-0'
    ], { cwd: sourceRoot, encoding: 'utf8' });
    assert.notEqual(child.status, 0, child.stdout + child.stderr);
    const competitor = join(installRoot, 'usr/local/libexec/amazon-research/subscription-supervisor.mjs');
    assert.equal(await readFile(competitor, 'utf8'), 'competitor\n');
    const info = await stat(competitor);
    assert.equal(info.isFile(), true);
    assert.equal(info.size, Buffer.byteLength('competitor\n'));
  });

  // Break: rollback deletes a target that no longer has the invocation-owned inode.
  it('preserves a published target replaced before rollback', async () => {
    const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
    const root = await mkdtemp(join(sourceRoot, '.task14-replaced-'));
    roots.push(root);
    const installRoot = join(root, 'target');
    await mkdir(join(installRoot, 'etc/amazon-research/subscription'), { recursive: true });
    await writeFile(join(installRoot, 'etc/amazon-research/subscription/endpoint-bindings.json'), await readFile(join(sourceRoot, 'ops/subscription-providers/endpoint-bindings.json')));
    const child = spawnSync('bash', [
      'ops/subscription-providers/install-systemd-sandbox.sh', 'install',
      '--fixture-root', `./${basename(root)}/target`, '--repository-root', '.',
      '--race-at', 'rollback-0'
    ], { cwd: sourceRoot, encoding: 'utf8' });
    assert.notEqual(child.status, 0, child.stdout + child.stderr);
    assert.match(child.stderr, /injected rollback replacement 0/u);
    assert.equal(await readFile(join(installRoot, 'usr/local/libexec/amazon-research/subscription-supervisor.mjs'), 'utf8'), 'replacement\n');
  });

  it('verifies installed fixture bytes and rejects installed unit or nft drift', async () => {
    const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
    const root = await mkdtemp(join(sourceRoot, '.task14-installed-'));
    roots.push(root);
    const installRoot = join(root, 'target');
    await mkdir(join(installRoot, 'etc/amazon-research/subscription'), { recursive: true });
    await writeFile(
      join(installRoot, 'etc/amazon-research/subscription/endpoint-bindings.json'),
      await readFile(join(sourceRoot, 'ops/subscription-providers/endpoint-bindings.json'))
    );
    const installer = 'ops/subscription-providers/install-systemd-sandbox.sh';
    const verifier = 'ops/subscription-providers/verify-runtime-profile.sh';
    const fixtureArguments = [
      '--fixture-root', `./${basename(root)}/target`,
      '--repository-root', '.'
    ];
    const installed = spawnSync('bash', [installer, 'install', ...fixtureArguments], { cwd: sourceRoot, encoding: 'utf8' });
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    const runFixtureVerify = () => spawnSync('bash', [
      verifier, 'verify', 'codex',
      '--fixture-root', `./${basename(root)}/target`,
      '--repository-root', '.'
    ], { cwd: sourceRoot, encoding: 'utf8' });
    const verified = runFixtureVerify();
    assert.equal(verified.status, 0, verified.stdout + verified.stderr);
    assert.equal(JSON.parse(verified.stdout).oracleHostVerified, false);

    const unit = join(installRoot, 'etc/systemd/system/amazon-research-codex@.service');
    const unitBytes = await readFile(unit);
    await chmod(unit, 0o600);
    await writeFile(unit, Buffer.concat([unitBytes, Buffer.from('\n# drift\n')]));
    const unitDrift = runFixtureVerify();
    assert.notEqual(unitDrift.status, 0);
    await writeFile(unit, unitBytes);

    const policy = join(installRoot, 'etc/nftables.d/amazon-research-subscription.nft');
    await chmod(policy, 0o600);
    await writeFile(policy, 'table inet drift {}\n');
    const policyDrift = runFixtureVerify();
    assert.notEqual(policyDrift.status, 0);
  });
});
const roots = [];
function categories(result) {
  return result.checks.filter((check) => !check.ok).map((check) => check.category);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('subscription provider derived local probe', () => {

  it('rejects the former fabricated all-true fixture', () => {
    const result = runLocalFixtureProbe({ allClaims: true, ok: true, oracleHostVerified: true });
    assert.equal(result.ok, false);
    assert.equal(result.localFixtureVerified, false);
    assert.equal(result.oracleHostVerified, false);
    assert.ok(categories(result).includes('self-attested-fixture-rejected'));
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

  it('executes the fixed local behavioral probe through the CLI without caller outcomes', () => {
    const child = spawnSync(process.execPath, [
      fileURLToPath(new URL('./probe-subscription-provider.mjs', import.meta.url)),
      '--mode', 'local-behavior', '--adapter', 'codex'
    ], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    const report = JSON.parse(child.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.evidence.provenance, 'task5-owner-executed-v1');
    assert.equal(report.oracleHostVerified, false);
  });

  it('does not export caller-authored derived acceptance', async () => {
    const result = await runDerivedLocalProbe();
    assert.equal(result.ok, false);
    assert.ok(categories(result).includes('caller-authored-evidence-rejected'));
  });
});
