const TABLE = 'amazon_research_subscription';
const FAMILY = 'inet';
const SET_TYPES = Object.freeze({
  resolver_v4: 'ipv4_addr', resolver_v6: 'ipv6_addr',
  codex_https_v4: 'ipv4_addr', codex_https_v6: 'ipv6_addr',
  grok_https_v4: 'ipv4_addr', grok_https_v6: 'ipv6_addr'
});

function nftMatch(protocol, field, right) {
  return { match: { op: '==', left: protocol === 'meta' ? { meta: { key: field } } : { payload: { protocol, field } }, right } };
}

function nftRule(uid, family, set, protocol, port, verdict) {
  const expr = [nftMatch('meta', 'skuid', uid)];
  if (family !== undefined) expr.push(nftMatch(family, 'daddr', { set }));
  if (protocol !== undefined) expr.push(nftMatch(protocol, 'dport', port));
  expr.push(verdict === 'accept' ? { accept: {} } : { reject: { type: 'icmpx', expr: 'admin-prohibited' } });
  return { rule: { family: FAMILY, table: TABLE, chain: 'output', expr } };
}

export function expectedNftRuleset(authority) {
  const families = (adapter, group, family) => {
    const value = authority.adapters[adapter][group];
    return authority.fixtureOnly ? value[family] : value.flatMap((record) => record[family]);
  };
  const resolvers = (family) => authority.fixtureOnly ? authority.resolvers[family] : authority.resolvers.flatMap((record) => record[family]);
  const values = (items) => [...new Set(items)].sort();
  const sets = {
    resolver_v4: values(resolvers('ipv4')), resolver_v6: values(resolvers('ipv6')),
    codex_https_v4: values([...families('codex', 'provider', 'ipv4'), ...families('codex', 'auth', 'ipv4')]),
    codex_https_v6: values([...families('codex', 'provider', 'ipv6'), ...families('codex', 'auth', 'ipv6')]),
    grok_https_v4: values([...families('grok', 'provider', 'ipv4'), ...families('grok', 'auth', 'ipv4')]),
    grok_https_v6: values([...families('grok', 'provider', 'ipv6'), ...families('grok', 'auth', 'ipv6')])
  };
  const nftables = [{ table: { family: FAMILY, name: TABLE } }];
  for (const [name, elem] of Object.entries(sets)) nftables.push({ set: { family: FAMILY, table: TABLE, name, type: SET_TYPES[name], flags: ['interval'], elem } });
  nftables.push({ chain: { family: FAMILY, table: TABLE, name: 'output', type: 'filter', hook: 'output', prio: 0, policy: 'accept' } });
  for (const adapter of ['codex', 'grok']) {
    const uid = `ara-${adapter}`;
    for (const [family, set] of [['ip', 'resolver_v4'], ['ip6', 'resolver_v6']]) {
      nftables.push(nftRule(uid, family, set, 'udp', 53, 'accept'));
      nftables.push(nftRule(uid, family, set, 'tcp', 53, 'accept'));
    }
    nftables.push(nftRule(uid, 'ip', `${adapter}_https_v4`, 'tcp', 443, 'accept'));
    nftables.push(nftRule(uid, 'ip6', `${adapter}_https_v6`, 'tcp', 443, 'accept'));
    nftables.push(nftRule(uid, undefined, undefined, undefined, undefined, 'reject'));
  }
  return { nftables };
}
function exactKeys(value, expected) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    Object.keys(value).sort().every((key, index) => key === [...expected].sort()[index]);
}

function semantic(value, required, optional = []) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const keys = Object.keys(value);
  if (required.some((key) => !keys.includes(key)) || keys.some((key) => !required.includes(key) && !optional.includes(key))) return undefined;
  return value;
}

function scalar(value) {
  if (typeof value === 'string' || Number.isInteger(value)) return String(value);
  if (exactKeys(value, ['prefix'])) {
    const prefix = value.prefix;
    if (!exactKeys(prefix, ['addr', 'len']) || typeof prefix.addr !== 'string' || !Number.isInteger(prefix.len)) {
      throw new TypeError('Malformed nft prefix.');
    }
    return `${prefix.addr}/${prefix.len}`;
  }
  throw new TypeError('Unknown nft scalar.');
}

function canonicalRule(rule) {
  if (semantic(rule, ['family', 'table', 'chain', 'expr'], ['handle']) === undefined) throw new TypeError('Unknown nft rule fields.');
  if (rule.family !== FAMILY || rule.table !== TABLE || rule.chain !== 'output' || !Array.isArray(rule.expr)) {
    throw new TypeError('Unexpected nft rule identity.');
  }
  const parts = [];
  for (const expression of rule.expr) {
    if (exactKeys(expression, ['match'])) {
      const match = expression.match;
      if (!exactKeys(match, ['op', 'left', 'right']) || match.op !== '==') throw new TypeError('Unknown nft match.');
      const left = match.left;
      if (!exactKeys(left, ['meta']) && !exactKeys(left, ['payload'])) throw new TypeError('Unknown nft match left side.');
      if (left.meta !== undefined) {
        if (left.meta.key !== 'skuid' || !exactKeys(left.meta, ['key'])) throw new TypeError('Unknown nft meta expression.');
        parts.push(`uid=${scalar(match.right)}`);
      } else {
        const payload = left.payload;
        if (!exactKeys(payload, ['protocol', 'field'])) throw new TypeError('Unknown nft payload expression.');
        if (!['ip', 'ip6', 'tcp', 'udp'].includes(payload.protocol) || !['daddr', 'dport'].includes(payload.field)) {
          throw new TypeError('Unknown nft payload field.');
        }
        const right = exactKeys(match.right, ['set']) ? `@${match.right.set}` : scalar(match.right);
        parts.push(`${payload.protocol}.${payload.field}=${right}`);
      }
      continue;
    }
    if (exactKeys(expression, ['accept'])) { if (!exactKeys(expression.accept, [])) throw new TypeError('Malformed accept.'); parts.push('accept'); continue; }
    if (exactKeys(expression, ['reject'])) { if (!exactKeys(expression.reject, ['type', 'expr']) || expression.reject.type !== 'icmpx' || expression.reject.expr !== 'admin-prohibited') throw new TypeError('Unknown reject.'); parts.push('reject'); continue; }
    throw new TypeError('Unknown nft rule expression.');
  }
  return parts.join('|');
}

export function canonicalizeActiveNftRuleset(input) {
  if (!exactKeys(input, ['nftables']) || !Array.isArray(input.nftables)) throw new TypeError('Malformed nft JSON document.');
  const sets = new Map();
  const rules = [];
  let table = 0;
  let chain = 0;
  for (const object of input.nftables) {
    if (exactKeys(object, ['metainfo'])) continue;
    if (exactKeys(object, ['table'])) {
      const value = semantic(object.table, ['family', 'name'], ['handle']);
      if (value === undefined || value.family !== FAMILY || value.name !== TABLE) throw new TypeError('Unexpected nft table.');
      table += 1; continue;
    }
    if (exactKeys(object, ['set'])) {
      const set = object.set;
      if (semantic(set, ['family', 'table', 'name', 'type', 'flags', 'elem'], ['handle']) === undefined || set.family !== FAMILY || set.table !== TABLE ||
          SET_TYPES[set.name] !== set.type || !Array.isArray(set.flags) || set.flags.length !== 1 || set.flags[0] !== 'interval' || !Array.isArray(set.elem)) {
        throw new TypeError('Unexpected nft set.');
      }
      if (sets.has(set.name)) throw new TypeError('Duplicate nft set.');
      sets.set(set.name, [...new Set(set.elem.map(scalar))].sort());
      continue;
    }
    if (exactKeys(object, ['chain'])) {
      const value = object.chain;
      if (semantic(value, ['family', 'table', 'name', 'type', 'hook', 'prio', 'policy'], ['handle']) === undefined || value.family !== FAMILY || value.table !== TABLE ||
          value.name !== 'output' || value.type !== 'filter' || value.hook !== 'output' || value.prio !== 0 || value.policy !== 'accept') {
        throw new TypeError('Unexpected nft chain.');
      }
      chain += 1; continue;
    }
    if (exactKeys(object, ['rule'])) { rules.push(canonicalRule(object.rule)); continue; }
    throw new TypeError('Unknown nft semantic object.');
  }
  if (table !== 1 || chain !== 1 || sets.size !== Object.keys(SET_TYPES).length || Object.keys(SET_TYPES).some((name) => !sets.has(name))) {
    throw new TypeError('Incomplete nft semantics.');
  }
  if (new Set(rules).size !== rules.length) throw new TypeError('Duplicate nft rule.');
  return JSON.stringify({ sets: Object.fromEntries([...sets].sort()), rules });
}

export function assertActiveNftMatches(expected, active) {
  const expectedCanonical = canonicalizeActiveNftRuleset(expected);
  const activeCanonical = canonicalizeActiveNftRuleset(active);
  if (activeCanonical !== expectedCanonical) throw new TypeError('Active nft policy drift.');
}

export function assertAuthorityActiveNftMatches(authority, active) {
  assertActiveNftMatches(expectedNftRuleset(authority), active);
}
