#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';

export const MAX_REPORT_BYTES = 32 * 1024;
const MAX_FIXTURE_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EVENTS = [
  'attempt-authorized', 'start-no-block', 'directory-created', 'directory-verified',
  'pre-start-waiting-no-request', 'request-tmp-written', 'request-renamed',
  'pre-start-validated', 'main-started', 'sandbox-validated', 'ready',
  'provider-fixture-started', 'result-tmp-written', 'result-renamed',
  'result-read', 'explicit-stop', 'cgroup-empty', 'exec-stop-post', 'terminal'
];

const AUTHORITY_KEYS = ['adapters', 'fixtureOnly', 'resolvers', 'review', 'schemaVersion'];
const ADAPTER_KEYS = ['auth', 'provider'];
const FAMILY_KEYS = ['ipv4', 'ipv6'];
const ADAPTERS = ['codex', 'grok'];

function keysAre(value, expected) {
  return object(value) && exact(Object.keys(value), expected);
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
    if (end - start > bestLength && end - start >= 2) {
      bestStart = start;
      bestLength = end - start;
    }
    start = end;
  }
  if (bestStart === -1) return words.map((word) => word.toString(16)).join(':');
  const left = words.slice(0, bestStart).map((word) => word.toString(16)).join(':');
  const right = words.slice(bestStart + bestLength).map((word) => word.toString(16)).join(':');
  return `${left}::${right}`;
}

function prohibitedAddress(number, family, fixtureOnly) {
  if (fixtureOnly) {
    return family === 4
      ? ![[ipv4Number('192.0.2.0'), 24], [ipv4Number('198.51.100.0'), 24], [ipv4Number('203.0.113.0'), 24]]
        .some(([network, bits]) => (number >> BigInt(32 - bits)) === (network >> BigInt(32 - bits)))
      : (number >> 96n) !== (ipv6Number('2001:db8::') >> 96n);
  }
  if (family === 4) {
    return number === 0n || number === 0xffffffffn ||
      (number >> 24n) === 10n || (number >> 24n) === 127n ||
      (number >> 20n) === (ipv4Number('172.16.0.0') >> 20n) ||
      (number >> 16n) === (ipv4Number('192.168.0.0') >> 16n) ||
      (number >> 16n) === (ipv4Number('169.254.0.0') >> 16n) ||
      (number >> 28n) === 0xen || number === ipv4Number('100.100.100.100');
  }
  return number === 0n || number === 1n ||
    (number >> 120n) === 0xffn || (number >> 118n) === 0x3fen;
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
  if (hostBits > 0 && (number & ((1n << BigInt(hostBits)) - 1n)) !== 0n) {
    throw new TypeError('Endpoint prefix has host bits.');
  }
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

function authorityBody(authority) {
  return {
    schemaVersion: authority.schemaVersion,
    fixtureOnly: authority.fixtureOnly,
    review: { identity: authority.review.identity, version: authority.review.version },
    resolvers: authority.resolvers,
    adapters: authority.adapters
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalizeEndpointAuthority(input, options = {}) {
  if (!keysAre(input, AUTHORITY_KEYS) || input.schemaVersion !== 1 || typeof input.fixtureOnly !== 'boolean' ||
      !keysAre(input.review, ['bindingsSha256', 'identity', 'version']) ||
      typeof input.review.identity !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,63}$/u.test(input.review.identity) ||
      typeof input.review.version !== 'string' || !/^[1-9][0-9]{0,9}$/u.test(input.review.version) ||
      !keysAre(input.resolvers, FAMILY_KEYS) || !keysAre(input.adapters, ADAPTERS)) {
    throw new TypeError('Endpoint authority schema rejected.');
  }
  const environment = options.environment ?? 'local-fixture';
  if (!['local-fixture', 'oracle'].includes(environment) || (environment === 'oracle' && input.fixtureOnly)) {
    throw new TypeError('Endpoint authority environment rejected.');
  }
  const fixtureOnly = input.fixtureOnly;
  const adapters = Object.fromEntries(ADAPTERS.map((adapter) => {
    const binding = input.adapters[adapter];
    if (!keysAre(binding, ADAPTER_KEYS)) throw new TypeError('Adapter endpoint schema rejected.');
    const groups = Object.fromEntries(ADAPTER_KEYS.map((group) => {
      if (!keysAre(binding[group], FAMILY_KEYS)) throw new TypeError('Endpoint family schema rejected.');
      return [group, {
        ipv4: canonicalFamily(binding[group].ipv4, 4, fixtureOnly, true),
        ipv6: canonicalFamily(binding[group].ipv6, 6, fixtureOnly, true)
      }];
    }));
    return [adapter, groups];
  }));
  const canonical = {
    schemaVersion: 1,
    fixtureOnly,
    review: { identity: input.review.identity, version: input.review.version },
    resolvers: {
      ipv4: canonicalFamily(input.resolvers.ipv4, 4, fixtureOnly, false),
      ipv6: canonicalFamily(input.resolvers.ipv6, 6, fixtureOnly, false)
    },
    adapters
  };
  const bindingsSha256 = sha256(`${JSON.stringify(authorityBody(canonical))}\n`);
  if (options.verifyDigest !== false && input.review.bindingsSha256 !== bindingsSha256) {
    throw new TypeError('Endpoint authority review digest rejected.');
  }
  return Object.freeze({ ...canonical, bindingsSha256 });
}

export function renderEndpointPolicy(authority) {
  const values = (items) => items.join(', ');
  const https = (adapter, family) => values([...new Set([
    ...authority.adapters[adapter].provider[family], ...authority.adapters[adapter].auth[family]
  ])].sort());
  const text = `table inet amazon_research_subscription {\n` +
    `  set resolver_v4 { type ipv4_addr; flags interval; elements = { ${values(authority.resolvers.ipv4)} } }\n` +
    `  set resolver_v6 { type ipv6_addr; flags interval; elements = { ${values(authority.resolvers.ipv6)} } }\n` +
    `  set codex_https_v4 { type ipv4_addr; flags interval; elements = { ${https('codex', 'ipv4')} } }\n` +
    `  set codex_https_v6 { type ipv6_addr; flags interval; elements = { ${https('codex', 'ipv6')} } }\n` +
    `  set grok_https_v4 { type ipv4_addr; flags interval; elements = { ${https('grok', 'ipv4')} } }\n` +
    `  set grok_https_v6 { type ipv6_addr; flags interval; elements = { ${https('grok', 'ipv6')} } }\n\n` +
    `  chain output {\n    type filter hook output priority filter; policy accept;\n\n` +
    `    meta skuid "ara-codex" ip daddr @resolver_v4 udp dport 53 accept\n` +
    `    meta skuid "ara-codex" ip daddr @resolver_v4 tcp dport 53 accept\n` +
    `    meta skuid "ara-codex" ip6 daddr @resolver_v6 udp dport 53 accept\n` +
    `    meta skuid "ara-codex" ip6 daddr @resolver_v6 tcp dport 53 accept\n` +
    `    meta skuid "ara-codex" ip daddr @codex_https_v4 tcp dport 443 accept\n` +
    `    meta skuid "ara-codex" ip6 daddr @codex_https_v6 tcp dport 443 accept\n` +
    `    meta skuid "ara-codex" reject\n\n` +
    `    meta skuid "ara-grok" ip daddr @resolver_v4 udp dport 53 accept\n` +
    `    meta skuid "ara-grok" ip daddr @resolver_v4 tcp dport 53 accept\n` +
    `    meta skuid "ara-grok" ip6 daddr @resolver_v6 udp dport 53 accept\n` +
    `    meta skuid "ara-grok" ip6 daddr @resolver_v6 tcp dport 53 accept\n` +
    `    meta skuid "ara-grok" ip daddr @grok_https_v4 tcp dport 443 accept\n` +
    `    meta skuid "ara-grok" ip6 daddr @grok_https_v6 tcp dport 443 accept\n` +
    `    meta skuid "ara-grok" reject\n  }\n}\n`;
  if (/elements = \{\s*\}/u.test(text)) throw new TypeError('Rendered endpoint policy contains an empty set.');
  return Object.freeze({ text, sha256: sha256(text) });
}
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exact(values, expected) {
  return Array.isArray(values) && values.length === expected.length &&
    [...values].sort().every((value, index) => value === [...expected].sort()[index]);
}


function check(category, ok) {
  return Object.freeze({ category, ok: Boolean(ok) });
}


function evaluateLifecycle(operations) {
  if (!Array.isArray(operations)) return { ok: false, events: [] };
  const events = [];
  let ready = false;
  let resultRead = false;
  let stopped = false;
  let cgroupEmpty = false;
  for (const operation of operations) {
    if (typeof operation !== 'string' || !EVENTS.includes(operation) || events.includes(operation)) {
      return { ok: false, events };
    }
    if (operation === 'ready') ready = true;
    if (operation === 'provider-fixture-started' && !ready) return { ok: false, events };
    if (operation === 'result-read' && !ready) return { ok: false, events };
    if (operation === 'result-read') resultRead = true;
    if (operation === 'explicit-stop' && !resultRead) return { ok: false, events };
    if (operation === 'explicit-stop') stopped = true;
    if (operation === 'cgroup-empty' && !stopped) return { ok: false, events };
    if (operation === 'cgroup-empty') cgroupEmpty = true;
    if (operation === 'exec-stop-post' && !cgroupEmpty) return { ok: false, events };
    events.push(operation);
  }
  return { ok: EVENTS.every((event, index) => events[index] === event), events };
}

function evaluateGc(states) {
  if (!Array.isArray(states)) return false;
  const decisions = states.map((state) => {
    if (!keysAre(state, ['activeState', 'ageMinutes', 'expected'])) return 'refuse';
    if (!['inactive', 'failed'].includes(state.activeState) || !Number.isInteger(state.ageMinutes)) return 'refuse';
    return state.ageMinutes > 10 ? 'remove' : 'refuse';
  });
  return states.length === 4 && states.every((state, index) => decisions[index] === state.expected);
}

export async function runDerivedLocalProbe(input) {
  const validEnvelope = object(input) && ['codex', 'grok'].includes(input.adapter) && UUID.test(input.attemptId ?? '') &&
    typeof input.repositoryRoot === 'string' && typeof input.runner === 'function';
  const checks = [check('fixture-envelope', validEnvelope)];
  if (!validEnvelope) return Object.freeze({ schemaVersion: 2, ok: false, checks, localFixtureVerified: false, oracleHostVerified: false, liveProviderVerified: false });
  const authorityPath = `${input.repositoryRoot}/ops/subscription-providers/endpoint-bindings.json`;
  const unitPath = `${input.repositoryRoot}/ops/systemd/amazon-research-${input.adapter}@.service`;
  const [authorityBytes, unitText] = await Promise.all([readFile(authorityPath), readFile(unitPath, 'utf8')]);
  const authority = canonicalizeEndpointAuthority(JSON.parse(authorityBytes.toString('utf8')), { environment: 'local-fixture' });
  const rendered = renderEndpointPolicy(authority);
  const unitOk = unitText.includes('Type=notify') && unitText.includes('KillMode=control-group') &&
    unitText.includes(`prepare-and-wait ${input.adapter} %i`) && unitText.includes(`cleanup ${input.adapter} %i`);
  const lifecycleEvidence = evaluateLifecycle(input.operations);
  const commandResults = [];
  for (const command of [
    ['node', ['--check', `${input.repositoryRoot}/ops/subscription-providers/subscription-supervisor.mjs`]],
    ['node', ['--check', `${input.repositoryRoot}/scripts/probe-subscription-provider.mjs`]]
  ]) {
    const result = await input.runner(command[0], command[1]);
    commandResults.push({ command: command[0], exitCode: result.exitCode });
  }
  checks.push(
    check('endpoint-authority', authority.fixtureOnly && rendered.text.includes('elements = {') && !/elements = \{\s*\}/u.test(rendered.text)),
    check('unit', unitOk),
    check('lifecycle', lifecycleEvidence.ok),
    check('gc', evaluateGc(input.gcStates)),
    check('fixed-command-plan', commandResults.every((result) => result.exitCode === 0))
  );
  return Object.freeze({
    schemaVersion: 2,
    ok: checks.every((entry) => entry.ok),
    mode: 'local-fixture',
    adapter: input.adapter,
    checks,
    evidence: {
      provenance: 'derived-local-v1',
      authoritySha256: sha256(authorityBytes),
      bindingsSha256: authority.bindingsSha256,
      renderedPolicySha256: rendered.sha256,
      unitSha256: sha256(unitText),
      lifecycleEvents: lifecycleEvidence.events,
      commandResults
    },
    localFixtureVerified: checks.every((entry) => entry.ok),
    oracleHostVerified: false,
    liveProviderVerified: false
  });
}

export function runLocalFixtureProbe() {
  return Object.freeze({
    schemaVersion: 2,
    ok: false,
    mode: 'local-fixture',
    adapter: null,
    checks: [check('self-attested-fixture-rejected', false)],
    localFixtureVerified: false,
    oracleHostVerified: false,
    liveProviderVerified: false
  });
}

function usageError() {
  throw new TypeError('Usage: local-fixture --fixture PATH or render-endpoint-policy --authority PATH --environment MODE');
}

async function readFixture(path) {
  if (typeof path !== 'string' || path.length === 0) usageError();
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_FIXTURE_BYTES) throw new RangeError('Fixture exceeds fixed size limit.');
  return JSON.parse(bytes.toString('utf8'));
}

function parseArguments(argv) {
  if (argv.length === 4 && argv[0] === '--mode' && argv[1] === 'local-fixture' && argv[2] === '--fixture') {
    return { mode: 'local-fixture', path: argv[3] };
  }
  if (argv.length === 6 && argv[0] === '--mode' && argv[1] === 'render-endpoint-policy' &&
      argv[2] === '--authority' && argv[4] === '--environment' &&
      ['local-fixture', 'oracle'].includes(argv[5])) {
    return { mode: 'render-endpoint-policy', path: argv[3], environment: argv[5] };
  }
  usageError();
}

function boundedJson(report) {
  const output = `${JSON.stringify(report)}\n`;
  if (Buffer.byteLength(output) > MAX_REPORT_BYTES) {
    throw new RangeError('Sanitized report exceeds fixed size limit.');
  }
  return output;
}

async function cli() {
  const args = parseArguments(process.argv.slice(2));
  if (args.mode === 'render-endpoint-policy') {
    const authority = canonicalizeEndpointAuthority(await readFixture(args.path), {
      environment: args.environment
    });
    process.stdout.write(renderEndpointPolicy(authority).text);
    return;
  }
  const report = runLocalFixtureProbe(await readFixture(args.path));
  process.stdout.write(boundedJson(report));
  if (!report.ok) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await cli();
  } catch {
    if (process.argv.includes('render-endpoint-policy')) {
      process.exitCode = 1;
    } else {
      const report = {
        schemaVersion: 1,
        ok: false,
        mode: 'local-fixture',
        adapter: null,
        checks: [check('fixture-envelope', false)],
        localFixtureVerified: false,
        oracleHostVerified: false,
        liveProviderVerified: false
      };
      process.stdout.write(boundedJson(report));
      process.exitCode = 1;
    }
  }
}
