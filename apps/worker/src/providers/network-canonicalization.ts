import { isIP } from 'node:net';

const IPV4_BITS = 32;
const IPV6_BITS = 128;
const IPV4_MAPPED_PREFIX = '::ffff:';

function parsePrefix(value: string, maximum: number): number {
  if (!/^(0|[1-9][0-9]{0,2})$/u.test(value)) {
    throw new TypeError('Network prefix length is invalid.');
  }
  const prefix = Number(value);
  if (prefix > maximum) {
    throw new TypeError('Network prefix length is invalid.');
  }
  return prefix;
}

function splitCidr(value: string): readonly [string, string] {
  const parts = value.split('/');
  const address = parts[0];
  const prefix = parts[1];
  if (parts.length !== 2 || address === undefined || prefix === undefined) {
    throw new TypeError('Network prefix is invalid.');
  }
  return [address, prefix];
}

function canonicalIpv4Address(value: string): string {
  if (isIP(value) !== 4) {
    throw new TypeError('IPv4 address is invalid.');
  }
  return value;
}

function canonicalIpv6Address(value: string): string {
  if (isIP(value) !== 6) {
    throw new TypeError('IPv6 address is invalid.');
  }
  const hostname = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  if (hostname.startsWith(IPV4_MAPPED_PREFIX)) {
    throw new TypeError('IPv4-mapped IPv6 addresses are not accepted.');
  }
  return hostname;
}

function ipv4ToInteger(value: string): bigint {
  return value.split('.').reduce(
    (result, octet) => (result << 8n) | BigInt(octet),
    0n
  );
}

function ipv4FromInteger(value: bigint): string {
  return [24n, 16n, 8n, 0n]
    .map((shift) => Number((value >> shift) & 0xffn))
    .join('.');
}

function ipv6ToInteger(value: string): bigint {
  const [leftText, rightText] = value.split('::');
  const left = leftText === '' || leftText === undefined ? [] : leftText.split(':');
  const right = rightText === '' || rightText === undefined ? [] : rightText.split(':');
  const missing = 8 - left.length - right.length;
  const groups = rightText === undefined
    ? left
    : [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  if (groups.length !== 8) {
    throw new TypeError('IPv6 address is invalid.');
  }
  return groups.reduce(
    (result, group) => (result << 16n) | BigInt(`0x${group}`),
    0n
  );
}

function ipv6FromInteger(value: bigint): string {
  const expanded = Array.from({ length: 8 }, (_, index) => {
    const shift = BigInt((7 - index) * 16);
    return ((value >> shift) & 0xffffn).toString(16);
  }).join(':');
  return new URL(`http://[${expanded}]/`).hostname.slice(1, -1);
}

function maskAddress(value: bigint, prefix: number, bits: number): bigint {
  if (prefix === 0) return 0n;
  const trailing = BigInt(bits - prefix);
  return (value >> trailing) << trailing;
}

export function canonicalIpAddress(value: string): string {
  const family = isIP(value);
  if (family === 4) return canonicalIpv4Address(value);
  if (family === 6) return canonicalIpv6Address(value);
  throw new TypeError('Resolver address is invalid.');
}

export function canonicalIpv4Cidr(value: string): string {
  const [addressText, prefixText] = splitCidr(value);
  const address = canonicalIpv4Address(addressText);
  const prefix = parsePrefix(prefixText, IPV4_BITS);
  return `${ipv4FromInteger(maskAddress(ipv4ToInteger(address), prefix, IPV4_BITS))}/${prefix}`;
}

export function canonicalIpv6Cidr(value: string): string {
  const [addressText, prefixText] = splitCidr(value);
  const address = canonicalIpv6Address(addressText);
  const prefix = parsePrefix(prefixText, IPV6_BITS);
  return `${ipv6FromInteger(maskAddress(ipv6ToInteger(address), prefix, IPV6_BITS))}/${prefix}`;
}
