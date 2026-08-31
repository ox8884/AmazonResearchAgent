#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { assertAuthorityActiveNftMatches } from './subscription-nft-semantics.mjs';
import { verifyInstalledArtifactsCore } from './installed-artifact-verifier.mjs';

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
// Intentionally empty until an independently reviewed production publication adds exact names, numeric UIDs, and prefixes.
const APPROVED_PRODUCTION_BINDINGS = Object.freeze({});
const FIXTURE_KEYS = ['adapters', 'fixtureOnly', 'identities', 'resolvers', 'review', 'schemaVersion'];
const PRODUCTION_KEYS = ['adapters', 'artifacts', 'fixtureOnly', 'identities', 'release', 'resolvers', 'review', 'schemaVersion'];
const REQUIRED_INSTALLED_PATHS = Object.freeze([
  '/usr/local/libexec/amazon-research/subscription-supervisor.mjs',
  '/usr/local/libexec/amazon-research/manage-invocation.sh',
  '/usr/local/libexec/amazon-research/subscription-gc-decision.mjs',
  '/usr/local/libexec/amazon-research/subscription-install-lock.mjs',
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
export async function openNoFollow(noFollow, openPath, pathname) {
  if (!Number.isInteger(noFollow)) throw new TypeError('Required O_NOFOLLOW primitive unavailable.');
  return openPath(pathname, noFollow | constants.O_RDONLY);
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
      identities: input.identities,
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
      !exactKeys(input.identities, ADAPTERS) || !exactKeys(input.resolvers, FAMILIES) || !exactKeys(input.adapters, ADAPTERS)) {
    throw new TypeError('Endpoint fixture schema rejected.');
  }
  const identities = canonicalIdentities(input.identities);
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
    identities,
    resolvers: {
      ipv4: canonicalFamily(input.resolvers.ipv4, 4, true, false),
      ipv6: canonicalFamily(input.resolvers.ipv6, 6, true, false)
    },
    adapters
  };
}

function canonicalIdentities(value) {
  if (!exactKeys(value, ADAPTERS)) throw new TypeError('Adapter identity schema rejected.');
  const seen = new Set();
  const identities = Object.fromEntries(ADAPTERS.map((adapter) => {
    const identity = value[adapter];
    const username = `ara-${adapter}`;
    if (!exactKeys(identity, ['uid', 'username']) || identity.username !== username ||
        !Number.isInteger(identity.uid) || identity.uid <= 0 || identity.uid > 0x7fffffff || seen.has(identity.uid)) {
      throw new TypeError('Adapter numeric UID authority rejected.');
    }
    seen.add(identity.uid);
    return [adapter, { username, uid: identity.uid }];
  }));
  return identities;
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
  if (!exactKeys(input, PRODUCTION_KEYS) || input.schemaVersion !== 3 || input.fixtureOnly !== false ||
      !exactKeys(input.release, ['commit', 'profile']) || !exactKeys(input.review, ['bindingsSha256', 'expiresAt', 'identity', 'reviewedAt', 'version']) ||
      !exactKeys(input.identities, ADAPTERS) || !exactKeys(input.adapters, ADAPTERS) || !object(input.artifacts) || !Array.isArray(input.resolvers)) {
    throw new TypeError('Production endpoint authority schema rejected.');
  }
  if (input.review.identity !== APPROVED_REVIEW.identity || input.review.version !== APPROVED_REVIEW.version) throw new TypeError('Production reviewer authority rejected.');
  if (input.release.commit !== APPROVED_RELEASE.commit || input.release.profile !== APPROVED_RELEASE.profile) throw new TypeError('Production release/profile binding rejected.');
  const reviewedAt = parseTimestamp(input.review.reviewedAt, 'reviewedAt');
  const expiresAt = parseTimestamp(input.review.expiresAt, 'expiresAt');
  if (reviewedAt > now || expiresAt <= now || expiresAt - reviewedAt > 86400000) throw new TypeError('Production review freshness rejected.');
  const identities = canonicalIdentities(input.identities);
  for (const adapter of ADAPTERS) {
    const approved = approvedBindings[`identity:${adapter}`];
    if (approved === undefined || approved.username !== identities[adapter].username || approved.uid !== identities[adapter].uid) {
      throw new TypeError('No reviewed production numeric UID authority is published.');
    }
  }
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
  return { schemaVersion: 3, fixtureOnly: false, release: input.release, review: {
    identity: input.review.identity, version: input.review.version, reviewedAt: input.review.reviewedAt, expiresAt: input.review.expiresAt
  }, identities, resolvers, adapters, artifacts };
}

export function canonicalizeEndpointAuthority(input, options) {
  if (options !== undefined) throw new TypeError('production canonicalizer rejects options');
  const canonical = canonicalProduction(input, Date.now(), APPROVED_PRODUCTION_BINDINGS);
  const canonicalInput = { ...canonical, review: { ...canonical.review, bindingsSha256: input.review?.bindingsSha256 } };
  const bindingsSha256 = computeEndpointAuthorityDigest(canonicalInput);
  if (input.review?.bindingsSha256 !== bindingsSha256) {
    throw new TypeError('Endpoint authority review digest rejected.');
  }
  return Object.freeze({ ...canonical, bindingsSha256 });
}

function canonicalizeLocalFixtureAuthority(input, verifyDigest = true) {
  const canonical = canonicalFixture(input);
  const canonicalInput = { ...canonical, review: { ...canonical.review, bindingsSha256: input.review?.bindingsSha256 } };
  const bindingsSha256 = computeEndpointAuthorityDigest(canonicalInput);
  if (verifyDigest && input.review?.bindingsSha256 !== bindingsSha256) {
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
  const uid = (adapter) => authority.identities[adapter].uid;
  const text = `table inet amazon_research_subscription {\n` +
    `  set resolver_v4 { type ipv4_addr; flags interval; elements = { ${values(resolverFamilies(authority, 'ipv4'))} } }\n` +
    `  set resolver_v6 { type ipv6_addr; flags interval; elements = { ${values(resolverFamilies(authority, 'ipv6'))} } }\n` +
    `  set codex_https_v4 { type ipv4_addr; flags interval; elements = { ${https('codex', 'ipv4')} } }\n` +
    `  set codex_https_v6 { type ipv6_addr; flags interval; elements = { ${https('codex', 'ipv6')} } }\n` +
    `  set grok_https_v4 { type ipv4_addr; flags interval; elements = { ${https('grok', 'ipv4')} } }\n` +
    `  set grok_https_v6 { type ipv6_addr; flags interval; elements = { ${https('grok', 'ipv6')} } }\n\n` +
    `  chain output {\n    type filter hook output priority filter; policy accept;\n\n` +
    `    meta skuid ${uid('codex')} ip daddr @resolver_v4 udp dport 53 accept\n    meta skuid ${uid('codex')} ip daddr @resolver_v4 tcp dport 53 accept\n` +
    `    meta skuid ${uid('codex')} ip6 daddr @resolver_v6 udp dport 53 accept\n    meta skuid ${uid('codex')} ip6 daddr @resolver_v6 tcp dport 53 accept\n` +
    `    meta skuid ${uid('codex')} ip daddr @codex_https_v4 tcp dport 443 accept\n    meta skuid ${uid('codex')} ip6 daddr @codex_https_v6 tcp dport 443 accept\n    meta skuid ${uid('codex')} reject\n\n` +
    `    meta skuid ${uid('grok')} ip daddr @resolver_v4 udp dport 53 accept\n    meta skuid ${uid('grok')} ip daddr @resolver_v4 tcp dport 53 accept\n` +
    `    meta skuid ${uid('grok')} ip6 daddr @resolver_v6 udp dport 53 accept\n    meta skuid ${uid('grok')} ip6 daddr @resolver_v6 tcp dport 53 accept\n` +
    `    meta skuid ${uid('grok')} ip daddr @grok_https_v4 tcp dport 443 accept\n    meta skuid ${uid('grok')} ip6 daddr @grok_https_v6 tcp dport 443 accept\n    meta skuid ${uid('grok')} reject\n  }\n}\n`;
  if (/elements = \{\s*\}/u.test(text)) throw new TypeError('Rendered endpoint policy contains an empty set.');
  return Object.freeze({ text, sha256: sha256(text) });
}

export async function verifyNssIdentity(authority, adapter, lookup = async (username) => {
  const { stdout, stderr } = await execFileAsync('getent', ['passwd', username], { windowsHide: true, timeout: 1_000, maxBuffer: 4096 });
  if (stderr.length !== 0) throw new TypeError('NSS lookup emitted stderr.');
  return stdout;
}) {
  if (!ADAPTERS.includes(adapter) || authority.fixtureOnly !== false) throw new TypeError('Production NSS authority required.');
  const identity = authority.identities[adapter];
  const records = [await lookup(identity.username), await lookup(identity.username)];
  if (records[0] !== records[1]) throw new TypeError('Inconsistent repeated NSS lookup.');
  const lines = records[0].split('\n').filter((line) => line.length > 0);
  if (lines.length !== 1) throw new TypeError('NSS record count rejected.');
  const fields = lines[0].split(':');
  if (fields.length !== 7 || fields[0] !== identity.username || !/^(?:[1-9][0-9]*)$/u.test(fields[2])) throw new TypeError('Reviewed NSS identity mismatch.');
  const nssUid = BigInt(fields[2]);
  if (nssUid > BigInt(0x7fffffff) || nssUid !== BigInt(identity.uid) || fields[6] !== '/usr/sbin/nologin') throw new TypeError('Reviewed NSS identity mismatch.');
  return Object.freeze({ username: identity.username, uid: identity.uid });
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

export async function verifyInstalledAuthority(authority, options) {
  if (options !== undefined) throw new TypeError('production installed verifier rejects options');
  if (authority.fixtureOnly || !object(authority.artifacts)) throw new TypeError('Production installed manifest required.');
  return verifyInstalledArtifactsCore(authority, REQUIRED_INSTALLED_PATHS, { constants, lstat, open });
}

function expectedLocalEvents(adapter, attemptId) {
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
const LOCAL_GC_MATRIX = [
  { activeState: 'active', ageMinutes: 30, decision: 'retain' },
  { activeState: 'inactive', ageMinutes: 5, decision: 'retain' },
  { activeState: 'unknown', ageMinutes: 30, decision: 'retain' },
  { activeState: 'inactive', ageMinutes: 11, decision: 'remove' }
];

export async function validateLocalEvidence(report, adapter, handoffRoot) {
  const keys = ['adapter', 'attemptId', 'cleanup', 'events', 'gc', 'liveProviderVerified', 'localFixtureVerified', 'ok', 'oracleHostVerified', 'profileId', 'provenance', 'request', 'result', 'schemaVersion', 'unitName'];
  if (!exactKeys(report, keys) || report.schemaVersion !== 2 || report.adapter !== adapter || report.provenance !== 'task5-owner-executed-v2' ||
      report.ok !== true || report.localFixtureVerified !== true || report.oracleHostVerified !== false || report.liveProviderVerified !== false ||
      typeof report.attemptId !== 'string' || !/^[0-9a-f-]{36}$/u.test(report.attemptId) || report.profileId !== `${adapter}-subscription-v1` ||
      report.unitName !== `amazon-research-${adapter}@${report.attemptId}.service`) throw new TypeError('Local evidence identity rejected.');
  if (JSON.stringify(report.events) !== JSON.stringify(expectedLocalEvents(adapter, report.attemptId))) throw new TypeError('Local evidence transcript rejected.');
  if (typeof handoffRoot !== 'string' || resolve(handoffRoot) !== handoffRoot) throw new TypeError('Parent artifact handoff rejected.');
  const observed = {};
  for (const name of ['request', 'result']) {
    const path = join(handoffRoot, `${name}.json`);
    const temporary = join(handoffRoot, `${name}.tmp`);
    const before = await lstat(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) throw new TypeError(`Local ${name} artifact type rejected.`);
    await lstat(temporary).then(() => { throw new TypeError(`Local ${name} atomic publication rejected.`); }, (error) => { if (error?.code !== 'ENOENT') throw error; });
    const handle = await openNoFollow(constants.O_NOFOLLOW, open, path);
    try {
      const descriptor = await handle.stat({ bigint: true });
      if (!descriptor.isFile() || descriptor.dev !== before.dev || descriptor.ino !== before.ino) throw new TypeError(`Local ${name} artifact identity rejected.`);
      const observedMode = Number(descriptor.mode & 0o777n);
      if (observedMode !== 0o640) throw new TypeError(`Local ${name} artifact mode rejected.`);
      const bytes = await handle.readFile();
      const afterDescriptor = await handle.stat({ bigint: true });
      const afterPath = await lstat(path, { bigint: true });
      if (!afterPath.isFile() || afterPath.isSymbolicLink() || descriptor.dev !== afterDescriptor.dev || descriptor.ino !== afterDescriptor.ino || descriptor.size !== afterDescriptor.size || descriptor.mtimeNs !== afterDescriptor.mtimeNs ||
          afterPath.dev !== descriptor.dev || afterPath.ino !== descriptor.ino || BigInt(bytes.byteLength) !== descriptor.size) throw new TypeError(`Local ${name} artifact replacement rejected.`);
      const value = JSON.parse(bytes.toString('utf8'));
      const expectedKeys = name === 'request' ? ['adapter', 'attemptId', 'inputHash', 'locale', 'modelId', 'profileId', 'prompt', 'role', 'version'] : ['adapter', 'attemptId', 'clientExit', 'outcome', 'rawOutput', 'version'];
      if (!exactKeys(value, expectedKeys) || value.version !== 1 || value.adapter !== adapter || value.attemptId !== report.attemptId) throw new TypeError(`Local ${name} artifact identity rejected.`);
      observed[name] = { size: bytes.byteLength, sha256: sha256(bytes), mode: Number(descriptor.mode & 0o777n), value };
    } finally {
      await handle.close();
    }
  }
  if (observed.request.value.profileId !== report.profileId || observed.request.value.role !== 'niche_normalization' || observed.request.value.inputHash !== '0'.repeat(64) ||
      observed.result.value.outcome !== 'success' || observed.result.value.rawOutput !== '{"ok":true}' || !exactKeys(observed.result.value.clientExit, ['code', 'signal']) ||
      observed.result.value.clientExit.code !== 0 || observed.result.value.clientExit.signal !== null) throw new TypeError('Local request/result relationship rejected.');
  for (const name of ['request', 'result']) {
    const value = report[name];
    const expected = `${report.attemptId}/${name}.json`;
    const expectedKeys = name === 'request' ? ['adapter', 'atomic', 'attemptId', 'expectedMode', 'observedMode', 'relativePath', 'sha256', 'size'] : ['adapter', 'atomic', 'attemptId', 'expectedMode', 'observedMode', 'rawOutputSha256', 'relativePath', 'sha256', 'size'];
    if (!exactKeys(value, expectedKeys) || value.relativePath !== expected || value.adapter !== adapter || value.attemptId !== report.attemptId || value.atomic !== true ||
        value.expectedMode !== 0o640 || value.observedMode !== observed[name].mode || value.size !== observed[name].size || value.sha256 !== observed[name].sha256) throw new TypeError(`Local ${name} artifact evidence rejected.`);
  }
  if (report.result.rawOutputSha256 !== sha256(observed.result.value.rawOutput) || JSON.stringify(report.gc) !== JSON.stringify(LOCAL_GC_MATRIX) ||
      !exactKeys(report.cleanup, ['absent', 'relativeRoot']) || report.cleanup.relativeRoot !== report.attemptId || report.cleanup.absent !== true) {
    throw new TypeError('Local result, GC, or cleanup evidence rejected.');
  }
}

async function runExecutedLocalProbe(adapter) {
  if (!ADAPTERS.includes(adapter)) throw new TypeError('Adapter rejected.');
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const tsxCli = resolve(repositoryRoot, 'apps/worker/node_modules/tsx/dist/cli.mjs');
  const harness = resolve(repositoryRoot, 'apps/worker/src/commands/subscription-local-evidence.ts');
  const sessionRoot = await mkdtemp(join(tmpdir(), 'ara-task14-parent-'));
  const handoffRoot = join(sessionRoot, 'handoff');
  const invocationRoot = join(sessionRoot, 'invocations');
  await mkdir(handoffRoot, { mode: 0o700 });
  await mkdir(invocationRoot, { mode: 0o700 });
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [tsxCli, harness, adapter, handoffRoot, invocationRoot], {
      cwd: repositoryRoot, windowsHide: true, timeout: 10_000, maxBuffer: MAX_REPORT_BYTES
    });
    if (stderr.length !== 0) throw new TypeError('Local evidence harness emitted stderr.');
    const report = JSON.parse(stdout);
    await validateLocalEvidence(report, adapter, handoffRoot);
    await lstat(join(invocationRoot, report.attemptId)).then(() => { throw new TypeError('Maintained invocation cleanup rejected.'); }, (error) => { if (error?.code !== 'ENOENT') throw error; });
    const parentGc = await Promise.all(LOCAL_GC_MATRIX.map(async ({ activeState, ageMinutes }) => {
      const owner = resolve(repositoryRoot, 'ops/subscription-providers/subscription-gc-decision.mjs');
      const { stdout: decision, stderr: gcError } = await execFileAsync(process.execPath, [owner, activeState, String(ageMinutes)], { timeout: 1_000, maxBuffer: 64 });
      if (gcError.length !== 0) throw new TypeError('Parent GC owner emitted stderr.');
      return { activeState, ageMinutes, decision: decision.trim() };
    }));
    if (JSON.stringify(parentGc) !== JSON.stringify(report.gc)) throw new TypeError('Parent GC owner evidence rejected.');
    const checks = [
      check('task5-owner-lifecycle', true), check('task5-ipc-atomicity', true),
      check('task5-gc-owner', true), check('fixture-cleanup', true)
    ];
    return Object.freeze({ schemaVersion: 3, ok: checks.every((entry) => entry.ok), mode: 'local-behavior', adapter, checks,
      evidence: report, localFixtureVerified: true, oracleHostVerified: false, liveProviderVerified: false });
  } finally {
    await rm(sessionRoot, { recursive: true, force: true });
    await lstat(sessionRoot).then(() => { throw new TypeError('Parent session cleanup rejected.'); }, (error) => { if (error?.code !== 'ENOENT') throw error; });
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
  if (argv.length === 6 && argv[0] === '--mode' && argv[1] === 'verify-active-nft' && argv[2] === '--authority' && argv[4] === '--active-json') return { mode: 'verify-active-nft', path: argv[3], activePath: argv[5] };
  if (argv.length === 6 && argv[0] === '--mode' && argv[1] === 'render-endpoint-policy' && argv[2] === '--authority' && argv[4] === '--environment' && ['local-fixture', 'oracle'].includes(argv[5])) return { mode: 'render-endpoint-policy', path: argv[3], environment: argv[5] };
  if (argv.length === 6 && argv[0] === '--mode' && argv[1] === 'verify-nss-identity' && argv[2] === '--authority' && argv[4] === '--adapter' && ADAPTERS.includes(argv[5])) return { mode: 'verify-nss-identity', path: argv[3], adapter: argv[5] };
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
    const input = await readFixture(args.path);
    const authority = args.environment === 'oracle'
      ? canonicalizeEndpointAuthority(input)
      : canonicalizeLocalFixtureAuthority(input);
    process.stdout.write(renderEndpointPolicy(authority).text);
    return;
  }
  if (args.mode === 'verify-installed') {
    const authority = canonicalizeEndpointAuthority(await readFixture(args.path));
    const verified = await verifyInstalledAuthority(authority);
    process.stdout.write(boundedJson({ schemaVersion: 1, ok: true, verifiedCount: verified.length }));
    return;
  }
  if (args.mode === 'verify-active-nft') {
    const authority = canonicalizeEndpointAuthority(await readFixture(args.path));
    assertAuthorityActiveNftMatches(authority, await readFixture(args.activePath));
    process.stdout.write(boundedJson({ schemaVersion: 1, ok: true, activeNftVerified: true }));
    return;
  }
  if (args.mode === 'verify-nss-identity') {
    const authority = canonicalizeEndpointAuthority(await readFixture(args.path));
    const identity = await verifyNssIdentity(authority, args.adapter);
    process.stdout.write(boundedJson({ schemaVersion: 1, ok: true, identity }));
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
