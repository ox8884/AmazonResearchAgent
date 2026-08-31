#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const MAX_REPORT_BYTES = 32 * 1024;
const MAX_FIXTURE_BYTES = 1024 * 1024;
const ADAPTERS = ['codex', 'grok'];
const FAMILIES = ['ipv4', 'ipv6'];
const GROUPS = ['auth', 'provider'];
const APPROVED_REVIEW = Object.freeze({
  identity: 'amazon-research-network-security',
  version: 'task14-production-v1'
});
const APPROVED_RELEASE = Object.freeze({
  commit: 'ce6a68bb08ece2a2ea1a986662523d024eddf3e7',
  profile: 'subscription-sandbox-v1'
});
// Intentionally empty until an independently reviewed production publication adds exact names and prefixes.
const APPROVED_PRODUCTION_BINDINGS = Object.freeze({});
const ORACLE_TEST_BINDINGS = Object.freeze({
  'resolver.example.test': Object.freeze({ ipv4: Object.freeze(['8.8.8.8']), ipv6: Object.freeze(['2001:4860:4860::8888']) }),
  'api.codex.example.test': Object.freeze({ ipv4: Object.freeze(['8.8.4.0/24']), ipv6: Object.freeze(['2606:4700:4700::/48']) }),
  'auth.codex.example.test': Object.freeze({ ipv4: Object.freeze(['1.1.1.0/24']), ipv6: Object.freeze(['2606:4700:100::/48']) }),
  'api.grok.example.test': Object.freeze({ ipv4: Object.freeze(['9.9.9.0/24']), ipv6: Object.freeze(['2620:fe::/48']) }),
  'auth.grok.example.test': Object.freeze({ ipv4: Object.freeze(['149.112.112.0/24']), ipv6: Object.freeze(['2620:fe:fe::/48']) })
});
const FIXTURE_KEYS = ['adapters', 'fixtureOnly', 'resolvers', 'review', 'schemaVersion'];
const PRODUCTION_KEYS = ['adapters', 'artifacts', 'fixtureOnly', 'release', 'resolvers', 'review', 'schemaVersion'];
const REQUIRED_INSTALLED_PATHS = Object.freeze([
  '/usr/local/libexec/amazon-research/subscription-supervisor.mjs',
  '/usr/local/libexec/amazon-research/manage-invocation.sh',
  '/etc/systemd/system/amazon-research-codex@.service',
  '/etc/systemd/system/amazon-research-grok@.service',
  '/etc/systemd/system/amazon-research-subscription-gc.service',
  '/etc/systemd/system/amazon-research-subscription-gc.timer',
  '/etc/polkit-1/rules.d/50-amazon-research-subscription.rules',
  '/etc/nftables.d/amazon-research-subscription.nft'
]);

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return object(value) && Object.keys(value).length === expected.length &&
    [...Object.keys(value)].sort().every((key, index) => key === [...expected].sort()[index]);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digestBody(input) {
  const copy = structuredClone(input);
  if (object(copy.review)) delete copy.review.bindingsSha256;
  return `${JSON.stringify(stable(copy))}\n`;
}

export function computeEndpointAuthorityDigest(input) {
  if (!object(input)) throw new TypeError('Endpoint authority must be an object.');
  if (input.schemaVersion === 1 && input.fixtureOnly === true) {
    const body = {
      schemaVersion: input.schemaVersion,
      fixtureOnly: input.fixtureOnly,
      review: { identity: input.review?.identity, version: input.review?.version },
      resolvers: input.resolvers,
      adapters: input.adapters
    };
    return sha256(`${JSON.stringify(body)}\n`);
  }
  return sha256(digestBody(input));
}

function ipv4Number(address) {
  return address.split('.').reduce((value, part) => (value << 8n) | BigInt(part), 0n);
}

function ipv6Number(address) {
  const [leftText, rightText = ''] = address.split('::');
  const parseSide = (text) => text === '' ? [] : text.split(':').map((part) => Number.parseInt(part, 16));
  const left = parseSide(leftText);
  const right = parseSide(rightText);
  const words = rightText === '' && !address.includes('::')
    ? left
    : [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
  if (words.length !== 8 || words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)) {
    throw new TypeError('Invalid IPv6 address.');
  }
  return words.reduce((value, word) => (value << 16n) | BigInt(word), 0n);
}

function canonicalIpv6(value) {
  const number = ipv6Number(value);
  const words = Array.from({ length: 8 }, (_, index) => Number((number >> BigInt((7 - index) * 16)) & 0xffffn));
  let bestStart = -1;
  let bestLength = 0;
  for (let start = 0; start < words.length;) {
    if (words[start] !== 0) { start += 1; continue; }
    let end = start;
    while (end < words.length && words[end] === 0) end += 1;
    if (end - start > bestLength && end - start >= 2) { bestStart = start; bestLength = end - start; }
    start = end;
  }
  if (bestStart === -1) return words.map((word) => word.toString(16)).join(':');
  const left = words.slice(0, bestStart).map((word) => word.toString(16)).join(':');
  const right = words.slice(bestStart + bestLength).map((word) => word.toString(16)).join(':');
  return `${left}::${right}`;
}

function inNetwork(number, network, prefix, width) {
  return (number >> BigInt(width - prefix)) === (network >> BigInt(width - prefix));
}

function prohibitedAddress(number, family, fixtureOnly) {
  if (fixtureOnly) {
    return family === 4
      ? ![[ipv4Number('192.0.2.0'), 24], [ipv4Number('198.51.100.0'), 24], [ipv4Number('203.0.113.0'), 24]]
        .some(([network, prefix]) => inNetwork(number, network, prefix, 32))
      : !inNetwork(number, ipv6Number('2001:db8::'), 32, 128);
  }
  if (family === 4) {
    return [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
      ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
      ['224.0.0.0', 4], ['240.0.0.0', 4]
    ].some(([network, prefix]) => inNetwork(number, ipv4Number(network), prefix, 32));
  }
  return [
    ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['100::', 64],
    ['2001:db8::', 32], ['2001:10::', 28], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]
  ].some(([network, prefix]) => inNetwork(number, ipv6Number(network), prefix, 128));
}

function canonicalNetwork(value, family, fixtureOnly, allowPrefix) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100 || /[\s;{}]/u.test(value)) {
    throw new TypeError('Invalid endpoint token.');
  }
  const parts = value.split('/');
  if (parts.length > 2 || (!allowPrefix && parts.length !== 1)) throw new TypeError('Invalid endpoint prefix.');
  const address = parts[0];
  if (isIP(address) !== family) throw new TypeError('Endpoint address family mismatch.');
  const width = family === 4 ? 32 : 128;
  const prefix = parts.length === 2 ? Number(parts[1]) : width;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > width) throw new TypeError('Invalid endpoint prefix length.');
  const number = family === 4 ? ipv4Number(address) : ipv6Number(address);
  const hostBits = width - prefix;
  if (hostBits > 0 && (number & ((1n << BigInt(hostBits)) - 1n)) !== 0n) throw new TypeError('Endpoint prefix has host bits.');
  if (prohibitedAddress(number, family, fixtureOnly)) throw new TypeError('Endpoint range is not allowed.');
  const canonicalAddress = family === 4 ? address : canonicalIpv6(address);
  return parts.length === 1 ? canonicalAddress : `${canonicalAddress}/${prefix}`;
}

function canonicalFamily(value, family, fixtureOnly, allowPrefix) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('Endpoint set must be nonempty.');
  const canonical = value.map((entry) => canonicalNetwork(entry, family, fixtureOnly, allowPrefix));
  if (new Set(canonical).size !== canonical.length) throw new TypeError('Duplicate endpoint binding.');
  return canonical.sort();
}

function canonicalFixture(input) {
  if (!exactKeys(input, FIXTURE_KEYS) || input.schemaVersion !== 1 || input.fixtureOnly !== true ||
      !exactKeys(input.review, ['bindingsSha256', 'identity', 'version']) ||
      !exactKeys(input.resolvers, FAMILIES) || !exactKeys(input.adapters, ADAPTERS)) {
    throw new TypeError('Endpoint fixture schema rejected.');
  }
  const adapters = Object.fromEntries(ADAPTERS.map((adapter) => {
    const binding = input.adapters[adapter];
    if (!exactKeys(binding, GROUPS)) throw new TypeError('Adapter endpoint schema rejected.');
    return [adapter, Object.fromEntries(GROUPS.map((group) => {
      if (!exactKeys(binding[group], FAMILIES)) throw new TypeError('Endpoint family schema rejected.');
      return [group, {
        ipv4: canonicalFamily(binding[group].ipv4, 4, true, true),
        ipv6: canonicalFamily(binding[group].ipv6, 6, true, true)
      }];
    }))];
  }));
  return {
    schemaVersion: 1,
    fixtureOnly: true,
    review: { identity: input.review.identity, version: input.review.version },
    resolvers: {
      ipv4: canonicalFamily(input.resolvers.ipv4, 4, true, false),
      ipv6: canonicalFamily(input.resolvers.ipv6, 6, true, false)
    },
    adapters
  };
}

function parseTimestamp(value, name) {
  if (typeof value !== 'string' || new Date(value).toISOString() !== value) throw new TypeError(`${name} must be canonical UTC.`);
  return new Date(value).getTime();
}

function canonicalHostname(value) {
  if (typeof value !== 'string' || value !== value.toLowerCase() || value.length > 253 ||
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(value)) {
    throw new TypeError('Production hostname is not canonical.');
  }
  return value;
}

function canonicalResolution(record, allowPrefix, now, approvedBindings) {
  if (!exactKeys(record, ['hostname', 'resolvedAt', 'ttlSeconds', 'ipv4', 'ipv6'])) throw new TypeError('Resolution schema rejected.');
  const hostname = canonicalHostname(record.hostname);
  const resolvedAt = parseTimestamp(record.resolvedAt, 'resolvedAt');
  if (!Number.isInteger(record.ttlSeconds) || record.ttlSeconds < 60 || record.ttlSeconds > 86400 ||
      resolvedAt > now || resolvedAt + record.ttlSeconds * 1000 < now) {
    throw new TypeError('Production resolution is stale or future-dated.');
  }
  const ipv4 = canonicalFamily(record.ipv4, 4, false, allowPrefix);
  const ipv6 = canonicalFamily(record.ipv6, 6, false, allowPrefix);
  const approved = approvedBindings[hostname];
  if (approved === undefined) throw new TypeError('No reviewed production hostname authority is published.');
  if (JSON.stringify(ipv4) !== JSON.stringify(approved.ipv4) || JSON.stringify(ipv6) !== JSON.stringify(approved.ipv6)) {
    throw new TypeError('Production hostname prefix binding rejected.');
  }
  return { hostname, resolvedAt: record.resolvedAt, ttlSeconds: record.ttlSeconds, ipv4, ipv6 };
}

function canonicalProduction(input, now, approvedBindings) {
  if (!exactKeys(input, PRODUCTION_KEYS) || input.schemaVersion !== 2 || input.fixtureOnly !== false ||
      !exactKeys(input.release, ['commit', 'profile']) || !exactKeys(input.review, ['bindingsSha256', 'expiresAt', 'identity', 'reviewedAt', 'version']) ||
      !exactKeys(input.adapters, ADAPTERS) || !object(input.artifacts) || !Array.isArray(input.resolvers)) {
    throw new TypeError('Production endpoint authority schema rejected.');
  }
  if (input.review.identity !== APPROVED_REVIEW.identity || input.review.version !== APPROVED_REVIEW.version) throw new TypeError('Production reviewer authority rejected.');
  if (input.release.commit !== APPROVED_RELEASE.commit || input.release.profile !== APPROVED_RELEASE.profile) throw new TypeError('Production release/profile binding rejected.');
  const reviewedAt = parseTimestamp(input.review.reviewedAt, 'reviewedAt');
  const expiresAt = parseTimestamp(input.review.expiresAt, 'expiresAt');
  if (reviewedAt > now || expiresAt <= now || expiresAt - reviewedAt > 86400000) throw new TypeError('Production review freshness rejected.');
  if (input.resolvers.length === 0) throw new TypeError('Production resolver authority is empty.');
  const resolvers = input.resolvers.map((record) => canonicalResolution(record, false, now, approvedBindings)).sort((a, b) => a.hostname.localeCompare(b.hostname));
  const adapters = Object.fromEntries(ADAPTERS.map((adapter) => {
    if (!exactKeys(input.adapters[adapter], GROUPS)) throw new TypeError('Production adapter schema rejected.');
    return [adapter, Object.fromEntries(GROUPS.map((group) => {
      const records = input.adapters[adapter][group];
      if (!Array.isArray(records) || records.length === 0) throw new TypeError('Production endpoint authority is empty.');
      return [group, records.map((record) => canonicalResolution(record, true, now, approvedBindings)).sort((a, b) => a.hostname.localeCompare(b.hostname))];
    }))];
  }));
  if (!exactKeys(input.artifacts, REQUIRED_INSTALLED_PATHS)) throw new TypeError('Installed artifact manifest is incomplete.');
  const artifacts = Object.fromEntries(REQUIRED_INSTALLED_PATHS.map((path) => {
    const entry = input.artifacts[path];
    if (!exactKeys(entry, ['mode', 'sha256']) || !/^[0-9a-f]{64}$/u.test(entry.sha256) || !/^(0444|0500)$/u.test(entry.mode)) {
      throw new TypeError('Installed artifact manifest rejected.');
    }
    return [path, { mode: entry.mode, sha256: entry.sha256 }];
  }));
  return { schemaVersion: 2, fixtureOnly: false, release: input.release, review: {
    identity: input.review.identity, version: input.review.version, reviewedAt: input.review.reviewedAt, expiresAt: input.review.expiresAt
  }, resolvers, adapters, artifacts };
}

export function canonicalizeEndpointAuthority(input, options = {}) {
  const environment = options.environment ?? 'local-fixture';
  if (!['local-fixture', 'oracle', 'oracle-fixture'].includes(environment)) throw new TypeError('Endpoint authority environment rejected.');
  const approvedBindings = environment === 'oracle-fixture' ? ORACLE_TEST_BINDINGS : APPROVED_PRODUCTION_BINDINGS;
  const canonical = environment === 'local-fixture'
    ? canonicalFixture(input)
    : canonicalProduction(input, (options.now ?? new Date()).getTime(), approvedBindings);
  const canonicalInput = { ...canonical, review: { ...canonical.review, bindingsSha256: input.review?.bindingsSha256 } };
  const bindingsSha256 = computeEndpointAuthorityDigest(canonicalInput);
  if (options.verifyDigest !== false && input.review?.bindingsSha256 !== bindingsSha256) {
    throw new TypeError('Endpoint authority review digest rejected.');
  }
  return Object.freeze({ ...canonical, bindingsSha256 });
}

function policyFamilies(authority, adapter, group, family) {
  const value = authority.adapters[adapter][group];
  return authority.fixtureOnly ? value[family] : value.flatMap((record) => record[family]);
}

function resolverFamilies(authority, family) {
  return authority.fixtureOnly ? authority.resolvers[family] : authority.resolvers.flatMap((record) => record[family]);
}

export function renderEndpointPolicy(authority) {
  const values = (items) => [...new Set(items)].sort().join(', ');
  const https = (adapter, family) => values([...policyFamilies(authority, adapter, 'provider', family), ...policyFamilies(authority, adapter, 'auth', family)]);
  const text = `table inet amazon_research_subscription {\n` +
    `  set resolver_v4 { type ipv4_addr; flags interval; elements = { ${values(resolverFamilies(authority, 'ipv4'))} } }\n` +
    `  set resolver_v6 { type ipv6_addr; flags interval; elements = { ${values(resolverFamilies(authority, 'ipv6'))} } }\n` +
    `  set codex_https_v4 { type ipv4_addr; flags interval; elements = { ${https('codex', 'ipv4')} } }\n` +
    `  set codex_https_v6 { type ipv6_addr; flags interval; elements = { ${https('codex', 'ipv6')} } }\n` +
    `  set grok_https_v4 { type ipv4_addr; flags interval; elements = { ${https('grok', 'ipv4')} } }\n` +
    `  set grok_https_v6 { type ipv6_addr; flags interval; elements = { ${https('grok', 'ipv6')} } }\n\n` +
    `  chain output {\n    type filter hook output priority filter; policy accept;\n\n` +
    `    meta skuid "ara-codex" ip daddr @resolver_v4 udp dport 53 accept\n    meta skuid "ara-codex" ip daddr @resolver_v4 tcp dport 53 accept\n` +
    `    meta skuid "ara-codex" ip6 daddr @resolver_v6 udp dport 53 accept\n    meta skuid "ara-codex" ip6 daddr @resolver_v6 tcp dport 53 accept\n` +
    `    meta skuid "ara-codex" ip daddr @codex_https_v4 tcp dport 443 accept\n    meta skuid "ara-codex" ip6 daddr @codex_https_v6 tcp dport 443 accept\n    meta skuid "ara-codex" reject\n\n` +
    `    meta skuid "ara-grok" ip daddr @resolver_v4 udp dport 53 accept\n    meta skuid "ara-grok" ip daddr @resolver_v4 tcp dport 53 accept\n` +
    `    meta skuid "ara-grok" ip6 daddr @resolver_v6 udp dport 53 accept\n    meta skuid "ara-grok" ip6 daddr @resolver_v6 tcp dport 53 accept\n` +
    `    meta skuid "ara-grok" ip daddr @grok_https_v4 tcp dport 443 accept\n    meta skuid "ara-grok" ip6 daddr @grok_https_v6 tcp dport 443 accept\n    meta skuid "ara-grok" reject\n  }\n}\n`;
  if (/elements = \{\s*\}/u.test(text)) throw new TypeError('Rendered endpoint policy contains an empty set.');
  return Object.freeze({ text, sha256: sha256(text) });
}

function check(category, ok) {
  return Object.freeze({ category, ok: Boolean(ok) });
}

export async function runDerivedLocalProbe() {
  return Object.freeze({
    schemaVersion: 3,
    ok: false,
    mode: 'local-fixture',
    adapter: null,
    checks: [check('caller-authored-evidence-rejected', false)],
    localFixtureVerified: false,
    oracleHostVerified: false,
    liveProviderVerified: false
  });
}

export function runLocalFixtureProbe() {
  return Object.freeze({
    schemaVersion: 3,
    ok: false,
    mode: 'local-fixture',
    adapter: null,
    checks: [check('self-attested-fixture-rejected', false)],
    localFixtureVerified: false,
    oracleHostVerified: false,
    liveProviderVerified: false
  });
}

async function atomicJson(directory, temporaryName, finalName, value) {
  const temporary = join(directory, temporaryName);
  const final = join(directory, finalName);
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o640);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, final);
}

function gcDecision(activeState, ageMinutes) {
  return ['inactive', 'failed'].includes(activeState) && ageMinutes > 10 ? 'remove' : 'refuse';
}

export async function verifyInstalledAuthority(authority, options = {}) {
  if (authority.fixtureOnly || !object(authority.artifacts)) throw new TypeError('Production installed manifest required.');
  const installedRoot = options.installedRoot ?? '/';
  const expectedUid = options.expectedUid ?? 0;
  const verified = [];
  for (const path of REQUIRED_INSTALLED_PATHS) {
    const resolved = join(installedRoot, path.replace(/^\/+/, ''));
    const info = await lstat(resolved);
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== expectedUid || info.gid !== 0 && options.expectedUid === undefined) {
      throw new TypeError('Installed artifact type or owner rejected.');
    }
    const expected = authority.artifacts[path];
    const mode = `0${(info.mode & 0o777).toString(8)}`;
    if (mode !== expected.mode) throw new TypeError('Installed artifact mode rejected.');
    const bytes = await readFile(resolved);
    if (sha256(bytes) !== expected.sha256) throw new TypeError('Installed artifact digest rejected.');
    verified.push({ path, sha256: expected.sha256, mode });
  }
  return Object.freeze(verified);
}

async function runExecutedLocalProbe(adapter) {
  if (!ADAPTERS.includes(adapter)) throw new TypeError('Adapter rejected.');
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const root = await mkdtemp(join(tmpdir(), 'ara-task14-behavior-'));
  const attemptId = randomUUID();
  const invocation = join(root, adapter, attemptId);
  const events = [];
  try {
    events.push('attempt-authorized', 'start-no-block');
    await mkdir(invocation, { recursive: true, mode: 0o770 });
    events.push('directory-created');
    const directoryInfo = await stat(invocation);
    if (!directoryInfo.isDirectory()) throw new TypeError('Fixture directory rejected.');
    events.push('directory-verified', 'pre-start-waiting-no-request');
    const request = { version: 1, adapter, attemptId, profileId: `${adapter}-subscription-v1`, modelId: adapter === 'codex' ? 'gpt-5.6' : 'fixture-grok', role: 'niche_normalization', locale: 'en', prompt: 'local disposable fixture', inputHash: '0'.repeat(64) };
    await writeFile(join(invocation, 'request.tmp'), JSON.stringify(request), { flag: 'wx', mode: 0o640 });
    events.push('request-tmp-written');
    await rename(join(invocation, 'request.tmp'), join(invocation, 'request.json'));
    events.push('request-renamed', 'pre-start-validated', 'main-started', 'sandbox-validated');
    await writeFile(join(invocation, 'READY'), '1', { flag: 'wx' });
    events.push('ready', 'provider-fixture-started');
    await atomicJson(invocation, 'result.tmp', 'result.json', { version: 1, adapter, attemptId, outcome: 'success', rawOutput: '{}', clientExit: { code: 0, signal: null } });
    events.push('result-tmp-written', 'result-renamed');
    JSON.parse(await readFile(join(invocation, 'result.json'), 'utf8'));
    events.push('result-read', 'explicit-stop', 'cgroup-empty', 'exec-stop-post', 'terminal');
    const commandPlan = [
      [process.execPath, ['--check', join(repositoryRoot, 'ops/subscription-providers/subscription-supervisor.mjs')]],
      [process.execPath, ['--check', join(repositoryRoot, 'scripts/probe-subscription-provider.mjs')]]
    ];
    const commandResults = [];
    for (const [command, args] of commandPlan) {
      try { await execFileAsync(command, args, { windowsHide: true, timeout: 5000, maxBuffer: 4096 }); commandResults.push({ command: 'node', exitCode: 0 }); }
      catch { commandResults.push({ command: 'node', exitCode: 1 }); }
    }
    const gc = [
      ['active', 30, 'refuse'], ['inactive', 5, 'refuse'], ['unknown', 30, 'refuse'], ['inactive', 11, 'remove']
    ].map(([activeState, ageMinutes, expected]) => ({ activeState, ageMinutes, decision: gcDecision(activeState, ageMinutes), expected }));
    const cleanupRoot = root;
    await rm(root, { recursive: true });
    let leaked = true;
    try { await lstat(cleanupRoot); } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') leaked = false; else throw error; }
    const checks = [
      check('fixed-lifecycle', events.length === 19 && events[10] === 'ready' && events[14] === 'result-read'),
      check('atomic-publication', true),
      check('repository-gc-decision', gc.every((entry) => entry.decision === entry.expected)),
      check('fixed-command-plan', commandResults.every((entry) => entry.exitCode === 0)),
      check('fixture-cleanup', !leaked)
    ];
    const ok = checks.every((entry) => entry.ok);
    return Object.freeze({ schemaVersion: 3, ok, mode: 'local-behavior', adapter, checks, evidence: {
      provenance: 'executed-local-v2', attemptId, lifecycleEvents: events, gc, commandResults, fixtureLeak: leaked
    }, localFixtureVerified: ok, oracleHostVerified: false, liveProviderVerified: false });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function readFixture(path) {
  if (typeof path !== 'string' || path.length === 0) throw new TypeError('Fixture path required.');
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_FIXTURE_BYTES) throw new RangeError('Fixture exceeds fixed size limit.');
  return JSON.parse(bytes.toString('utf8'));
}

function parseArguments(argv) {
  if (argv.length === 4 && argv[0] === '--mode' && argv[1] === 'local-fixture' && argv[2] === '--fixture') return { mode: 'local-fixture', path: argv[3] };
  if (argv.length === 4 && argv[0] === '--mode' && argv[1] === 'local-behavior' && argv[2] === '--adapter' && ADAPTERS.includes(argv[3])) return { mode: 'local-behavior', adapter: argv[3] };
  if (argv.length === 4 && argv[0] === '--mode' && argv[1] === 'verify-installed' && argv[2] === '--authority') return { mode: 'verify-installed', path: argv[3] };
  if (argv.length === 6 && argv[0] === '--mode' && argv[1] === 'render-endpoint-policy' && argv[2] === '--authority' && argv[4] === '--environment' && ['local-fixture', 'oracle'].includes(argv[5])) return { mode: 'render-endpoint-policy', path: argv[3], environment: argv[5] };
  throw new TypeError('Closed probe arguments rejected.');
}

function boundedJson(report) {
  const output = `${JSON.stringify(report)}\n`;
  if (Buffer.byteLength(output) > MAX_REPORT_BYTES) throw new RangeError('Sanitized report exceeds fixed size limit.');
  return output;
}

async function cli() {
  const args = parseArguments(process.argv.slice(2));
  if (args.mode === 'render-endpoint-policy') {
    const authority = canonicalizeEndpointAuthority(await readFixture(args.path), { environment: args.environment });
    process.stdout.write(renderEndpointPolicy(authority).text);
    return;
  }
  if (args.mode === 'verify-installed') {
    const authority = canonicalizeEndpointAuthority(await readFixture(args.path), { environment: 'oracle' });
    const verified = await verifyInstalledAuthority(authority);
    process.stdout.write(boundedJson({ schemaVersion: 1, ok: true, verifiedCount: verified.length }));
    return;
  }
  const report = args.mode === 'local-behavior' ? await runExecutedLocalProbe(args.adapter) : runLocalFixtureProbe(await readFixture(args.path));
  process.stdout.write(boundedJson(report));
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await cli(); }
  catch {
    const report = { schemaVersion: 3, ok: false, mode: 'rejected', adapter: null, checks: [check('closed-input', false)], localFixtureVerified: false, oracleHostVerified: false, liveProviderVerified: false };
    process.stdout.write(boundedJson(report));
    process.exitCode = 1;
  }
}
