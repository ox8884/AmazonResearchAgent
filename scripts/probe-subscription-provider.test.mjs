import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  MAX_REPORT_BYTES,
  canonicalizeEndpointAuthority,
  computeEndpointAuthorityDigest,
  renderEndpointPolicy,
  runDerivedLocalProbe,
  runLocalFixtureProbe,
  validateLocalEvidence,
  verifyNssIdentity
} from './probe-subscription-provider.mjs';
import { verifyInstalledAuthority, openNoFollow } from './probe-subscription-provider.mjs';
import { assertActiveNftMatches, assertAuthorityActiveNftMatches, expectedNftRuleset } from './subscription-nft-semantics.mjs';
import { verifyInstalledArtifactsCore } from './installed-artifact-verifier.mjs';
const gcDecisionPath = fileURLToPath(new URL('../ops/subscription-providers/subscription-gc-decision.mjs', import.meta.url));

describe('subscription GC module entrypoint', () => {
  // Break: the POSIX absolute argv path is converted to a four-slash file URL and skips the CLI body.
  it('executes as a CLI and remains inert when imported', () => {
    const cli = spawnSync(process.execPath, [gcDecisionPath, 'inactive', '11'], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(cli.stdout, 'remove\n');
    const imported = spawnSync(process.execPath, ['--input-type=module', '--eval', `await import(${JSON.stringify(new URL('../ops/subscription-providers/subscription-gc-decision.mjs', import.meta.url).href)})`], { encoding: 'utf8' });
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout, '');
  });
});
const nobleFixturePath = fileURLToPath(new URL('../tests/fixtures/nftables-noble-1.0.9-parser.json', import.meta.url));

const fixtureAuthority = () => ({
  schemaVersion: 1,
  fixtureOnly: true,
  review: {
    identity: 'task14-local-fixture',
    version: '1',
    bindingsSha256: 'pending'
  },
  identities: {
    codex: { username: 'ara-codex', uid: 20001 },
    grok: { username: 'ara-grok', uid: 20002 }
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
    schemaVersion: 3,
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
    identities: {
      codex: { username: 'ara-codex', uid: 20001 },
      grok: { username: 'ara-grok', uid: 20002 }
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
      '/usr/local/libexec/amazon-research/subscription-install-lock.mjs',
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
    assert.match(child.stdout, /meta skuid 20001/u);
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
    ['Tailscale address', (a) => { a.fixtureOnly = false; a.resolvers.ipv4 = ['100.100.100.100']; }],
    ['UID zero', (a) => { a.identities.codex.uid = 0; }],
    ['duplicate UID', (a) => { a.identities.grok.uid = a.identities.codex.uid; }],
    ['username drift', (a) => { a.identities.codex.username = 'ara-other'; }],
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
      /No reviewed production numeric UID authority is published/u
    );
  });

  describe('reviewed numeric UID NSS equality', () => {
    const authority = { fixtureOnly: false, identities: { codex: { username: 'ara-codex', uid: 31001 }, grok: { username: 'ara-grok', uid: 31002 } } };

    it('accepts one stable exact reviewed NSS record', async () => {
      await assert.doesNotReject(verifyNssIdentity(authority, 'codex', async () => 'ara-codex:x:31001:31001::/nonexistent:/usr/sbin/nologin\n'));
    });

    for (const [name, records] of [
      ['UID drift', ['ara-codex:x:31002:31001::/nonexistent:/usr/sbin/nologin\n']],
      ['UID zero', ['ara-codex:x:0:31001::/nonexistent:/usr/sbin/nologin\n']],
      ['nonnumeric UID', ['ara-codex:x:not-a-uid:31001::/nonexistent:/usr/sbin/nologin\n']],
      ['username drift', ['ara-other:x:31001:31001::/nonexistent:/usr/sbin/nologin\n']],
      ['malformed record', ['ara-codex:x:31001\n']],
      ['duplicate records', ['ara-codex:x:31001:31001::/nonexistent:/usr/sbin/nologin\nara-codex:x:31001:31001::/nonexistent:/usr/sbin/nologin\n']],
      ['repeated lookup drift', ['ara-codex:x:31001:31001::/nonexistent:/usr/sbin/nologin\n', 'ara-codex:x:31002:31001::/nonexistent:/usr/sbin/nologin\n']]
    ]) {
      it(`rejects ${name}`, async () => {
        let index = 0;
        await assert.rejects(verifyNssIdentity(authority, 'codex', async () => records[Math.min(index++, records.length - 1)]));
      });
    }

    for (const [name, uidText] of [
      ['leading-zero UID 031001', '031001'],
      ['decimal above accepted UID range 2147483648', '2147483648'],
      ['precision form that must not round into the reviewed UID', '31001.0'],
      ['numeric overflow above reviewed range 2147483649', '2147483649']
    ]) {
      it(`rejects injected canonicality ${name}`, async () => {
        await assert.rejects(
          verifyNssIdentity(authority, 'codex', async () => `ara-codex:x:${uidText}:31001::/nonexistent:/usr/sbin/nologin\n`)
        );
      });
    }

    it('accepts the canonical positive decimal reviewed UID', async () => {
      await assert.doesNotReject(verifyNssIdentity(authority, 'codex', async () => 'ara-codex:x:31001:31001::/nonexistent:/usr/sbin/nologin\n'));
    });

    it('rejects fixture authority before NSS lookup', async () => {
      let called = false;
      await assert.rejects(verifyNssIdentity({ ...authority, fixtureOnly: true }, 'codex', async () => { called = true; return ''; }), /Production NSS authority required/u);
      assert.equal(called, false);
    });
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
    ['wrong UID', (rules) => { rules.nftables.find((entry) => entry.rule).rule.expr[0].match.right = 29999; }],
    ['wrong family', (rules) => { rules.nftables.find((entry) => entry.rule).rule.expr[1].match.left.payload.protocol = 'ip6'; }],
    ['wrong port', (rules) => { rules.nftables.find((entry) => entry.rule).rule.expr[2].match.right = 54; }],
    ['wrong hook', (rules) => { rules.nftables.find((entry) => entry.chain).chain.hook = 'input'; }],
    ['wrong priority', (rules) => { rules.nftables.find((entry) => entry.chain).chain.prio = 1; }],
    ['wrong policy', (rules) => { rules.nftables.find((entry) => entry.chain).chain.policy = 'drop'; }],
    ['unknown semantic object', (rules) => rules.nftables.push({ flowtable: {} })],
    ['truncated output', (rules) => { rules.nftables = rules.nftables.slice(0, 2); }],
    ['named UID', (rules) => { rules.nftables.find((entry) => entry.rule).rule.expr[0].match.right = 'ara-codex'; }],
    ['reordered rule', (rules) => { const first = rules.nftables.findIndex((entry) => entry.rule); [rules.nftables[first], rules.nftables[first + 1]] = [rules.nftables[first + 1], rules.nftables[first]]; }],
    ['extra presentation field', (rules) => { rules.nftables.find((entry) => entry.rule).rule.comment = 'not inert'; }],
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

  it('accepts exact Noble 1.0.9 metainfo and filter priority form', () => {
    const active = clone();
    active.nftables.unshift({ metainfo: { version: '1.0.9', release_name: 'Old Doc Yak #3', json_schema_version: 1 } });
    active.nftables.find((entry) => entry.chain).chain.prio = 'filter';
    assert.doesNotThrow(() => assertActiveNftMatches(expected(), active));
  });

  it('normalizes documented null reject to the target reject semantics', () => {
    const active = clone();
    const reject = active.nftables.findLast((entry) => entry.rule);
    reject.rule.expr.at(-1).reject = null;
    assert.doesNotThrow(() => assertActiveNftMatches(expected(), active));
  });

  it('consumes the pinned Noble parser capture provenance and target forms', async () => {
    const fixture = JSON.parse(await readFile(nobleFixturePath, 'utf8'));
    assert.equal(fixture.source.nftablesVersion, '1.0.9-1build1');
    assert.equal(fixture.source.architecture, 'amd64');
    assert.equal(fixture.renderedInputSha256, 'b56cd39aff84fff0e1fc6a95e446b3b0a70edd5310da3f3cb99264c4d8bef44e');
    assert.equal(fixture.jsonOutputSha256, '896be47824b3d96876c4e43a3a1c86401857435f377dcb451925b6443e8bc392');
    const authority = reviewedFixtureAuthority();
    assert.doesNotThrow(() => assertAuthorityActiveNftMatches(authority, fixture.json));
    assert.equal(fixture.json.nftables.filter((entry) => entry.rule).length, 14);
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
describe('installed artifact stable descriptor core', () => {
  const path = '/fixed/artifact';
  const bytes = Buffer.from('approved');
  const base = { dev: 1n, ino: 2n, uid: 0n, gid: 0n, mode: 0o100500n, size: BigInt(bytes.length), mtimeNs: 10n, ctimeNs: 11n, isFile: () => true, isSymbolicLink: () => false };
  const authority = { artifacts: { [path]: { mode: '0500', sha256: '2687f86ed6784b8a5fca36e6c468e12aa44dc3c7e8137e3160d1a95079bdcd02' } } };
  function fsFixture(overrides = {}) {
    let closeCount = 0; let statCount = 0; let lstatCount = 0;
    const handle = { stat: async () => { statCount += 1; return statCount === 1 ? base : (overrides.afterDescriptor ?? base); }, readFile: async () => overrides.readBytes ?? bytes, close: async () => { closeCount += 1; } };
    const fs = { constants: { O_RDONLY: 0, O_NOFOLLOW: 1 }, open: async () => handle, lstat: async () => { lstatCount += 1; return lstatCount === 1 ? (overrides.beforePath ?? base) : (overrides.afterPath ?? base); } };
    if (overrides.noFollow === null) delete fs.constants.O_NOFOLLOW;
    return { fs, closed: () => closeCount };
  }

  it('accepts one stable descriptor and closes exactly once', async () => {
    const fixture = fsFixture();
    await assert.doesNotReject(verifyInstalledArtifactsCore(authority, [path], fixture.fs));
    assert.equal(fixture.closed(), 1);
  });

  for (const [name, overrides, message] of [
    ['missing O_NOFOLLOW', { noFollow: null }, /O_NOFOLLOW/u],
    ['pre-open replacement', { beforePath: { ...base, ino: 3n } }, /identity/u],
    ['in-place size mutation', { afterDescriptor: { ...base, size: base.size + 1n } }, /descriptor read/u],
    ['mtime mutation', { afterDescriptor: { ...base, mtimeNs: 12n } }, /descriptor read/u],
    ['path replacement', { afterPath: { ...base, ino: 4n } }, /path changed/u],
    ['partial read', { readBytes: Buffer.from('short') }, /descriptor read/u],
    ['digest mismatch', { readBytes: Buffer.from('disguise') }, /digest/u]
  ]) {
    it(`rejects ${name} and closes any opened descriptor once`, async () => {
      const fixture = fsFixture(overrides);
      await assert.rejects(verifyInstalledArtifactsCore(authority, [path], fixture.fs), message);
      assert.equal(fixture.closed(), name === 'missing O_NOFOLLOW' ? 0 : 1);
    });
  }
});

describe('openNoFollow fail-closed validator', () => {
  it('rejects a non-integer O_NOFOLLOW before opening the target', async () => {
    let opened = false;
    await assert.rejects(
      openNoFollow('missing', async () => { opened = true; return {}; }, '/unused'),
      /O_NOFOLLOW primitive unavailable/u
    );
    assert.equal(opened, false);
  });

  it('opens with O_RDONLY | O_NOFOLLOW only for an integer primitive', async () => {
    const flags = [];
    const openedPath = await openNoFollow(0o200000, async (path, flag) => { flags.push(flag); return path; }, '/target');
    assert.equal(openedPath, '/target');
    assert.deepEqual(flags, [0o200000 | 0]);
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

  it('rolls back every created file and parent after a late atomic publication failure', { skip: process.platform === 'win32' }, async () => {
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
    ], { cwd: sourceRoot, encoding: 'utf8', env: { ...process.env, TMPDIR: root } });
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
    assert.deepEqual(await readdir(root), ['target'], 'ordinary rollback leaves no transaction staging residue');
  });

  // Break: an unlinked owned file can reuse its inode for an unrelated replacement on ext4.
  it('demonstrates immediate inode reuse after unlink', { skip: process.platform !== 'linux' }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'ara-task14-inode-reuse-'));
    roots.push(root);
    const original = join(root, 'original');
    const replacement = join(root, 'replacement');
    await writeFile(original, 'owned\n');
    const owned = await stat(original, { bigint: true });
    await rm(original);
    await writeFile(replacement, 'competitor\n');
    const competitor = await stat(replacement, { bigint: true });
    assert.equal(`${competitor.dev}:${competitor.ino}`, `${owned.dev}:${owned.ino}`, 'native Linux filesystem did not immediately reuse the unlinked inode');
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
  it('preserves a published target replaced before rollback', { skip: process.platform === 'win32' }, async () => {
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

  // Break: first fixture installation fails before lock-helper bootstrap, descriptor verification, staging, and publication.
  it('completes first fixture installation through the lock-helper bootstrap and rejects installed unit or nft drift', async () => {
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
    assert.match(installed.stdout, /^PASS mode=install artifacts=11 /u);
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

  // Break: a group/other-writable fixture final parent permits untrusted publication-path substitution.
  it('rejects a group/other-writable fixture final publication parent', { skip: process.platform === 'win32' }, async () => {
    const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
    const root = await mkdtemp(join(sourceRoot, '.task14-final-parent-'));
    roots.push(root);
    const installRoot = join(root, 'target');
    const finalParent = join(installRoot, 'usr/local/libexec/amazon-research');
    await mkdir(join(installRoot, 'etc/amazon-research/subscription'), { recursive: true });
    await mkdir(finalParent, { recursive: true, mode: 0o777 });
    await chmod(finalParent, 0o777);
    await writeFile(
      join(installRoot, 'etc/amazon-research/subscription/endpoint-bindings.json'),
      await readFile(join(sourceRoot, 'ops/subscription-providers/endpoint-bindings.json'))
    );

    const child = spawnSync('bash', [
      'ops/subscription-providers/install-systemd-sandbox.sh', 'install',
      '--fixture-root', `./${basename(root)}/target`, '--repository-root', '.'
    ], { cwd: sourceRoot, encoding: 'utf8' });

    assert.notEqual(child.status, 0, child.stdout + child.stderr);
    assert.match(child.stderr, /unsafe final parent/u);
    await assert.rejects(stat(join(finalParent, 'subscription-supervisor.mjs')), { code: 'ENOENT' });
  });

  // Break: production final publication accepts root-owned group/other-writable parents.
  it('requires root ownership and no group/other write bits for production final publication parents', async () => {
    const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
    const installer = await readFile(join(sourceRoot, 'ops/subscription-providers/install-systemd-sandbox.sh'), 'utf8');
    const predicate = installer.match(/verify_publication_parent\(\) \{[\s\S]*?\n\}/u)?.[0] ?? '';

    assert.match(predicate, /\[\[ "\$owner_mode" == 0:0:\* \]\] && \(\( \( 8#\$mode & 022 \) == 0 \)\) \|\| fail/u);
  });
  // Break: opening the fixed lock follows a symlink and truncates its referent before validation.
  it('rejects a symlink lock without changing its referent', async () => {
    const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
    const root = await mkdtemp(join(sourceRoot, '.task14-lock-symlink-'));
    roots.push(root);
    const installRoot = join(root, 'target');
    const lockParent = join(installRoot, 'run/lock');
    const victim = join(root, 'victim');
    const victimBytes = Buffer.from('attacker-owned-bytes\n');
    await mkdir(join(installRoot, 'etc/amazon-research/subscription'), { recursive: true });
    await mkdir(lockParent, { recursive: true });
    await writeFile(join(installRoot, 'etc/amazon-research/subscription/endpoint-bindings.json'), await readFile(join(sourceRoot, 'ops/subscription-providers/endpoint-bindings.json')));
    await writeFile(victim, victimBytes, { mode: 0o644 });
    const victimMode = (await lstat(victim)).mode & 0o777;
    await symlink(victim, join(lockParent, 'amazon-research-subscription-install.lock'));

    const child = spawnSync('bash', [
      'ops/subscription-providers/install-systemd-sandbox.sh', 'install',
      '--fixture-root', `./${basename(root)}/target`, '--repository-root', '.'
    ], { cwd: sourceRoot, encoding: 'utf8' });

    assert.notEqual(child.status, 0);
    assert.deepEqual(await readFile(victim), victimBytes);
    assert.equal((await lstat(victim)).mode & 0o777, victimMode);
  });
  it('fails before mutation when the installation transaction lock is held', async () => {
    const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
    const root = await mkdtemp(join(sourceRoot, '.task14-lock-'));
    roots.push(root);
    const installRoot = join(root, 'target');
    await mkdir(join(installRoot, 'etc/amazon-research/subscription'), { recursive: true });
    await mkdir(join(installRoot, 'run/lock'), { recursive: true });
    await writeFile(join(installRoot, 'etc/amazon-research/subscription/endpoint-bindings.json'), await readFile(join(sourceRoot, 'ops/subscription-providers/endpoint-bindings.json')));
    const lock = `./${basename(root)}/target/run/lock/amazon-research-subscription-install.lock`;
    const holder = spawn('bash', ['-c', `exec 8>"${lock}"; flock 8; printf ready; sleep 30`], { cwd: sourceRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await new Promise((resolveReady, rejectReady) => {
        const timer = setTimeout(() => rejectReady(new Error('lock holder readiness timeout')), 2_000);
        holder.stdout.once('data', (chunk) => { if (String(chunk) === 'ready') { clearTimeout(timer); resolveReady(); } });
        holder.once('exit', (code) => { clearTimeout(timer); rejectReady(new Error(`lock holder exited ${code}`)); });
      });
      const child = spawnSync('bash', [
        'ops/subscription-providers/install-systemd-sandbox.sh', 'install',
        '--fixture-root', `./${basename(root)}/target`, '--repository-root', '.'
      ], { cwd: sourceRoot, encoding: 'utf8' });
      assert.notEqual(child.status, 0);
      assert.match(child.stderr, /installation transaction is busy/u);
      await assert.rejects(stat(join(installRoot, 'usr/local/libexec/amazon-research/subscription-supervisor.mjs')), { code: 'ENOENT' });
      assert.equal((await readFile(join(installRoot, 'etc/amazon-research/subscription/endpoint-bindings.json'))).length > 0, true);
    } finally {
      holder.kill();
    }
  });

});
async function postStageReplacementRunner(root) {
  const runner = join(root, 'post-stage-replacement-runner.sh');
  await writeFile(runner, `#!/usr/bin/env bash
export ARA_FIXTURE_POST_STAGE_LOCK_HELPER_REPLACEMENT=1
exec bash "$@"
`);
  return `./${basename(root)}/post-stage-replacement-runner.sh`;
}

async function lockAuthorityFixture(kind) {
  const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
  const root = await mkdtemp(join(sourceRoot, '.task14-lock-authority-'));
  roots.push(root);
  const repository = join(root, 'repo');
  const installRoot = join(root, 'target');
  const marker = join(root, 'executed');
  await mkdir(join(repository, 'scripts'), { recursive: true });
  const fixtureSources = [
    'scripts/probe-subscription-provider.mjs',
    'scripts/subscription-nft-semantics.mjs',
    'scripts/installed-artifact-verifier.mjs',
    'ops/subscription-providers/endpoint-bindings.json',
    'ops/subscription-providers/subscription-supervisor.mjs',
    'ops/subscription-providers/manage-invocation.sh',
    'ops/systemd/amazon-research-codex@.service',
    'ops/systemd/amazon-research-grok@.service',
    'ops/systemd/amazon-research-subscription-gc.service',
    'ops/systemd/amazon-research-subscription-gc.timer',
    'ops/polkit/50-amazon-research-subscription.rules',
    'ops/subscription-providers/subscription-gc-decision.mjs',
    'ops/nftables/amazon-research-subscription.nft'
  ];
  await Promise.all(fixtureSources.map(async (sourceRelative) => {
    const destination = join(repository, sourceRelative);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(join(sourceRoot, sourceRelative)));
  }));
  const installerSource = 'ops/subscription-providers/install-systemd-sandbox.sh';
  const helperSource = join(sourceRoot, 'scripts/subscription-install-lock.mjs');
  await mkdir(join(installRoot, 'etc/amazon-research/subscription'), { recursive: true });
  await writeFile(join(installRoot, 'etc/amazon-research/subscription/endpoint-bindings.json'), await readFile(join(sourceRoot, 'ops/subscription-providers/endpoint-bindings.json')));
  const helper = join(repository, 'scripts/subscription-install-lock.mjs');
  const hostileMarker = `${helper}.post-validation-hostile-executed`;
  const malicious = `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, 'executed');
process.exit(91);
`;
  if (kind === 'missing') {
    // leave absent
  } else if (kind === 'symlink') {
    await symlink(helperSource, helper);
  } else if (kind === 'wrong-mode') {
    await writeFile(helper, await readFile(helperSource), { mode: 0o600 });
  } else {
    await writeFile(helper, kind === 'post-validation-swap' || kind === 'untrusted-parent'
      ? await readFile(helperSource)
      : malicious, { mode: 0o644 });
  }
  const environment = { ...process.env, ARA_REPOSITORY_ROOT: repository, ARA_INSTALL_ROOT: installRoot, ARA_FIXTURE_MODE: '1' };
  if (kind === 'untrusted-parent') {
    const parent = join(installRoot, 'run/lock');
    await mkdir(parent, { recursive: true, mode: 0o777 });
    await chmod(parent, 0o777);
  }
  const fixtureRoot = `./${basename(root)}`;
  const installerArguments = [installerSource, 'install', '--fixture-root', `${fixtureRoot}/target`, '--repository-root', `${fixtureRoot}/repo`];
  const child = spawnSync('bash', kind === 'post-validation-swap'
    ? [await postStageReplacementRunner(root), ...installerArguments]
    : installerArguments, {
    cwd: sourceRoot,
    encoding: 'utf8',
    env: environment
  });
  return { child, helper, hostileMarker, marker };
}

describe('subscription lock helper install authority', () => {
  const helperAttacks = [
    ['missing', /lock helper descriptor rejected/u],
    ['substituted', /lock helper digest rejected/u],
    ['symlink', /lock helper descriptor rejected/u],
    ...(process.platform === 'win32' ? [] : [['wrong-mode', /lock helper mode rejected/u]]),
    ['wrong-digest', /lock helper digest rejected/u]
  ];
  for (const [kind, rejection] of helperAttacks) {
    // Break: an unverified repository helper executes before release authority validation.
    it(`rejects ${kind} helper before execution`, async () => {
      const { child, marker } = await lockAuthorityFixture(kind);
      assert.notEqual(child.status, 0, child.stdout + child.stderr);
      assert.match(child.stderr, rejection);
      await assert.rejects(stat(marker), { code: 'ENOENT' });
    });
  }

  // Break: helper-controlled code runs before any authoritative byte check.
  it('never permits a pre-verification helper marker', async () => {
    const { child, marker } = await lockAuthorityFixture('pre-verification');
    assert.notEqual(child.status, 0, child.stdout + child.stderr);
    assert.match(child.stderr, /lock helper digest rejected/u);
    await assert.rejects(stat(marker), { code: 'ENOENT' });
  });

  // Break: reopening the source helper after staging would execute the controlled hostile replacement.
  it('executes the verified staged helper after source replacement', async () => {
    const { child, helper, hostileMarker } = await lockAuthorityFixture('post-validation-swap');
    assert.equal(child.status, 0, child.stdout + child.stderr);
    assert.match(child.stdout, /fixture post-stage lock helper replacement completed/u);
    assert.match(child.stdout, /PASS mode=install artifacts=11 .*production_activation=false/u);
    assert.match(await readFile(helper, 'utf8'), /post-validation-hostile-executed/u);
    await assert.rejects(stat(hostileMarker), { code: 'ENOENT' });
  });

  it('rejects post-stage helper replacement injection outside fixture mode', async () => {
    const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
    const root = await mkdtemp(join(sourceRoot, '.task14-lock-authority-'));
    roots.push(root);
    const child = spawnSync('bash', [
      await postStageReplacementRunner(root),
      'ops/subscription-providers/install-systemd-sandbox.sh', 'dry-run'
    ], {
      cwd: sourceRoot,
      encoding: 'utf8'
    });
    assert.notEqual(child.status, 0, child.stdout + child.stderr);
    assert.match(child.stderr, /fixture post-stage lock helper replacement rejected/u);
  });

  // Break: a writable staging parent lets another principal replace the verified staged helper.
  it('rejects an untrusted lock staging parent before helper execution', { skip: process.platform === 'win32' }, async () => {
    const { child, marker } = await lockAuthorityFixture('untrusted-parent');
    assert.notEqual(child.status, 0, child.stdout + child.stderr);
    assert.match(child.stderr, /transaction staging parent rejected/u);
    await assert.rejects(stat(marker), { code: 'ENOENT' });
  });
  const lockPath = '/usr/local/libexec/amazon-research/subscription-install-lock.mjs';

  it('proves the installer dry-run artifact count includes the lock helper', async () => {
    const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
    const child = spawnSync('bash', [
      'ops/subscription-providers/install-systemd-sandbox.sh', 'dry-run'
    ], { cwd: sourceRoot, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    assert.match(child.stdout, /PASS mode=dry-run artifacts=11 /u);
  });

  it('rejects a lock-helper digest or mode that does not match the reviewed manifest', async () => {
    const authority = productionAuthority();
    const lockEntry = authority.artifacts[lockPath];
    assert.equal(lockEntry.mode, '0500');
    assert.match(lockEntry.sha256, /^[0-9a-f]{64}$/u);
    const goodBytes = await readFile(new URL('../scripts/subscription-install-lock.mjs', import.meta.url));
    const tampered = Buffer.concat([goodBytes.subarray(0, goodBytes.length - 1), Buffer.from([goodBytes[goodBytes.length - 1] ^ 0xff])]);
    const digestBase = { dev: 1n, ino: 2n, uid: 0n, gid: 0n, mode: 0o100500n, size: BigInt(tampered.length), mtimeNs: 10n, ctimeNs: 11n, isFile: () => true, isSymbolicLink: () => false };
    const digestHandle = { stat: async () => digestBase, readFile: async () => tampered, close: async () => {} };
    const digestPath = { ...digestBase, isFile: () => true, isSymbolicLink: () => false };
    const digestFixture = { constants: { O_RDONLY: 0, O_NOFOLLOW: 1 }, open: async () => digestHandle, lstat: async () => digestPath };
    await assert.rejects(verifyInstalledArtifactsCore(authority, [lockPath], digestFixture), /digest rejected/u);
    const modeBase = { dev: 1n, ino: 2n, uid: 0n, gid: 0n, mode: 0o100444n, size: BigInt(goodBytes.length), mtimeNs: 10n, ctimeNs: 11n, isFile: () => true, isSymbolicLink: () => false };
    const modeHandle = { stat: async () => modeBase, readFile: async () => goodBytes, close: async () => {} };
    const modePath = { ...modeBase, isFile: () => true, isSymbolicLink: () => false };
    const modeFixture = { constants: { O_RDONLY: 0, O_NOFOLLOW: 1 }, open: async () => modeHandle, lstat: async () => modePath };
    const { createHash } = await import('node:crypto');
    const wrongAuthority = { artifacts: { [lockPath]: { mode: '0500', sha256: createHash('sha256').update(goodBytes).digest('hex') } } };
    await assert.rejects(verifyInstalledArtifactsCore(wrongAuthority, [lockPath], modeFixture), /mode rejected/u);
  });

  it('verifies the lock helper before any protected writer executes it', async () => {
    const authority = productionAuthority();
    assert.equal(authority.artifacts[lockPath].mode, '0500');
    const goodBytes = await readFile(new URL('../scripts/subscription-install-lock.mjs', import.meta.url));
    const { createHash } = await import('node:crypto');
    authority.artifacts[lockPath].sha256 = createHash('sha256').update(goodBytes).digest('hex');
    const orderBase = { dev: 1n, ino: 2n, uid: 0n, gid: 0n, mode: 0o100500n, size: BigInt(goodBytes.length), mtimeNs: 10n, ctimeNs: 11n, isFile: () => true, isSymbolicLink: () => false };
    const orderHandle = { stat: async () => orderBase, readFile: async () => goodBytes, close: async () => {} };
    const orderPath = { ...orderBase, isFile: () => true, isSymbolicLink: () => false };
    const fs = { constants: { O_RDONLY: 0, O_NOFOLLOW: 1 }, open: async () => orderHandle, lstat: async () => orderPath };
    const verified = await verifyInstalledArtifactsCore(authority, [lockPath], fs);
    assert.equal(verified.length, 1);
    assert.equal(verified[0].path, lockPath);
    assert.equal(verified[0].mode, '0500');
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
  const hasOnoFollow = Number.isInteger(fsConstants.O_NOFOLLOW);
  const e2e = hasOnoFollow ? it : it.skip;

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

  e2e('executes the fixed local behavioral probe through the CLI without caller outcomes', () => {
    const child = spawnSync(process.execPath, [
      fileURLToPath(new URL('./probe-subscription-provider.mjs', import.meta.url)),
      '--mode', 'local-behavior', '--adapter', 'codex'
    ], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    const report = JSON.parse(child.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.evidence.provenance, 'task5-owner-executed-v2');
    assert.equal(report.oracleHostVerified, false);
  });

  e2e('rejects hostile parent evidence with preserved lengths and booleans', async () => {
    const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
    const handoffRoot = await mkdtemp(join(tmpdir(), 'ara-task14-hostile-parent-'));
    const invocationRoot = join(handoffRoot, 'invocations');
    const artifactRoot = join(handoffRoot, 'artifacts');
    await mkdir(invocationRoot, { recursive: true });
    await mkdir(artifactRoot, { recursive: true });
    roots.push(handoffRoot);
    const child = spawnSync(process.execPath, [
      join(sourceRoot, 'apps/worker/node_modules/tsx/dist/cli.mjs'),
      join(sourceRoot, 'apps/worker/src/commands/subscription-local-evidence.ts'),
      'codex', artifactRoot, invocationRoot
    ], { cwd: sourceRoot, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    const baseline = JSON.parse(child.stdout);
    await assert.doesNotReject(validateLocalEvidence(baseline, 'codex', artifactRoot));
    const wrongTuple = structuredClone(baseline);
    wrongTuple.events[6].observed.sequence = 2;
    await assert.rejects(validateLocalEvidence(wrongTuple, 'codex', artifactRoot), /transcript rejected/u);
    const wrongGc = structuredClone(baseline);
    wrongGc.gc[3].decision = 'retain';
    await assert.rejects(validateLocalEvidence(wrongGc, 'codex', artifactRoot), /GC, or cleanup evidence rejected/u);
    const fabricated = structuredClone(baseline);
    fabricated.request.size = 1;
    fabricated.result.size = 1;
    fabricated.request.sha256 = '0'.repeat(64);
    fabricated.result.sha256 = '0'.repeat(64);
    fabricated.request.observedMode = 0;
    fabricated.result.observedMode = 0;
    await assert.rejects(validateLocalEvidence(fabricated, 'codex', artifactRoot), /artifact evidence rejected/u);
    const widened = structuredClone(baseline);
    await chmod(join(artifactRoot, 'request.json'), 0o666);
    await chmod(join(artifactRoot, 'result.json'), 0o666);
    widened.request.observedMode = 0o666;
    widened.result.observedMode = 0o666;
    await assert.rejects(validateLocalEvidence(widened, 'codex', artifactRoot), /artifact mode rejected/u);
  });

  it('does not export caller-authored derived acceptance', async () => {
    const result = await runDerivedLocalProbe();
    assert.equal(result.ok, false);
    assert.ok(categories(result).includes('caller-authored-evidence-rejected'));
  });
});
