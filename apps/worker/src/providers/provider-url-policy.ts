import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type ProviderNetworkScope = 'public' | 'private' | 'loopback';
type AddressCategory = ProviderNetworkScope | 'blocked';

export type ProviderAddressResolver = (
  hostname: string
) => Promise<readonly { readonly address: string }[]>;

export class ProviderUrlPolicyError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'ProviderUrlPolicyError';
  }
}

function isMetadataIpv4(address: string): boolean {
  return address === '169.254.169.254' || address === '100.100.100.200';
}

function ipv4Category(address: string): AddressCategory {
  if (isMetadataIpv4(address)) {
    return 'blocked';
  }
  const parts = address.split('.').map(Number);
  const [a, b] = parts;
  if (a === 127) {
    return 'loopback';
  }
  if (
    a === 10 ||
    (a === 100 && b !== undefined && b >= 64 && b <= 127) ||
    (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  ) {
    return 'private';
  }
  if (
    a === 169 && b === 254 ||
    a === 0 ||
    (a !== undefined && a >= 224)
  ) {
    return 'blocked';
  }
  return 'public';
}

function mappedIpv4Address(address: string): string | null {
  if (!address.startsWith('::ffff:')) {
    return null;
  }
  const suffix = address.slice('::ffff:'.length);
  if (isIP(suffix) === 4) {
    return suffix;
  }
  const groups = suffix.split(':');
  if (groups.length !== 2) {
    return null;
  }
  const high = Number.parseInt(groups[0] ?? '', 16);
  const low = Number.parseInt(groups[1] ?? '', 16);
  if (
    !Number.isInteger(high) ||
    !Number.isInteger(low) ||
    high < 0 ||
    high > 0xffff ||
    low < 0 ||
    low > 0xffff
  ) {
    return null;
  }
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

function ipv6Category(address: string): AddressCategory {
  const normalized = address.toLocaleLowerCase('en-US');
  const mappedIpv4 = mappedIpv4Address(normalized);
  if (mappedIpv4) {
    return ipv4Category(mappedIpv4);
  }
  if (normalized === '::1') {
    return 'loopback';
  }
  if (normalized === 'fd00:ec2::254') {
    return 'blocked';
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return 'private';
  }
  if (
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized === '::' ||
    normalized.startsWith('ff')
  ) {
    return 'blocked';
  }
  return 'public';
}

function normalizedHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

function addressCategory(address: string): AddressCategory {
  const family = isIP(address);
  if (family === 4) {
    return ipv4Category(address);
  }
  if (family === 6) {
    return ipv6Category(address);
  }
  throw new ProviderUrlPolicyError(
    'Provider hostname did not resolve to an IP address.'
  );
}

const resolveAddresses: ProviderAddressResolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

export async function validateProviderBaseUrl(
  value: string,
  scope: ProviderNetworkScope,
  resolveAddress: ProviderAddressResolver = resolveAddresses
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new ProviderUrlPolicyError('Provider URL is invalid.', error);
  }
  if (url.username || url.password) {
    throw new ProviderUrlPolicyError('Provider URL credentials are not allowed.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProviderUrlPolicyError('Provider URL must use HTTP or HTTPS.');
  }
  if (scope === 'public' && url.protocol !== 'https:') {
    throw new ProviderUrlPolicyError('Public provider URLs must use HTTPS.');
  }

  const hostname = normalizedHostname(url.hostname);
  let addresses: readonly { readonly address: string }[];
  try {
    addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await resolveAddress(hostname);
  } catch (error) {
    if (error instanceof ProviderUrlPolicyError) {
      throw error;
    }
    throw new ProviderUrlPolicyError('Provider hostname lookup failed.', error);
  }
  if (addresses.length === 0) {
    throw new ProviderUrlPolicyError('Provider hostname did not resolve.');
  }
  for (const { address } of addresses) {
    const category = addressCategory(address);
    if (category === 'blocked') {
      throw new ProviderUrlPolicyError('Provider destination is not allowed.');
    }
    if (scope === 'public' && category !== 'public') {
      throw new ProviderUrlPolicyError(
        'Public provider destination is not public.'
      );
    }
    if (scope === 'private' && category === 'loopback') {
      throw new ProviderUrlPolicyError(
        'Private provider destination cannot be loopback.'
      );
    }
    if (scope === 'loopback' && category !== 'loopback') {
      throw new ProviderUrlPolicyError(
        'Loopback provider destination must resolve locally.'
      );
    }
  }
  return url;
}
