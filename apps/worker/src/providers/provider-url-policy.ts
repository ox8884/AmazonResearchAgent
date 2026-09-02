import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { Agent, type Dispatcher } from 'undici';

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
  const pinned = await pinProviderDestination(value, scope, resolveAddress);
  return pinned.url;
}

export interface PinnedProviderDestination {
  readonly url: URL;
  readonly connectHost: string;
  readonly hostnameHeader: string;
  readonly tlsServername: string;
}

export async function pinProviderDestination(
  value: string,
  scope: ProviderNetworkScope,
  resolveAddress: ProviderAddressResolver = resolveAddresses
): Promise<PinnedProviderDestination> {
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
  const chosen = addresses[0];
  if (!chosen) {
    throw new ProviderUrlPolicyError('Provider hostname did not resolve.');
  }
  const connectHost =
    isIP(chosen.address) === 6 ? `[${chosen.address}]` : chosen.address;
  return {
    url,
    connectHost,
    hostnameHeader: url.host,
    tlsServername: hostname
  };
}
function nodeReadableToWebStream(source: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      source.on('data', (chunk: Buffer | string) => {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        controller.enqueue(new Uint8Array(bytes));
        if (controller.desiredSize !== null && controller.desiredSize <= 0) {
          source.pause();
        }
      });
      source.once('end', () => {
        controller.close();
      });
      source.once('error', (error: Error) => {
        controller.error(error);
      });
    },
    pull() {
      source.resume();
    },
    cancel() {
      source.destroy();
    }
  });
}

export function createPinnedProviderFetch(
  scope: ProviderNetworkScope,
  resolveAddress: ProviderAddressResolver = resolveAddresses
): typeof fetch {
  const agents = new Map<string, Agent>();
  return async (input, init) => {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const pin = await pinProviderDestination(rawUrl, scope, resolveAddress);
    const original = new URL(rawUrl);
    const origin = `${original.protocol}//${pin.connectHost}${original.port ? `:${original.port}` : ''}`;
    const headers: string[] = [];
    const incoming = new Headers(init?.headers);
    if (input instanceof Request) {
      input.headers.forEach((value, key) => {
        if (!incoming.has(key)) {
          incoming.set(key, value);
        }
      });
    }
    incoming.forEach((value, key) => {
      if (key.toLowerCase() !== 'host') {
        headers.push(key, value);
      }
    });
    headers.push('host', pin.hostnameHeader);
    const existing = agents.get(pin.tlsServername);
    const dispatcher =
      existing ??
      new Agent({
        connect: { servername: pin.tlsServername }
      });
    if (!existing) {
      agents.set(pin.tlsServername, dispatcher);
    }
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const requestInit: Dispatcher.RequestOptions = {
      origin,
      path: `${original.pathname}${original.search}`,
      method,
      headers
    };
    const requestBody =
      typeof init?.body === 'string' || init?.body instanceof Uint8Array
        ? init.body
        : input instanceof Request && input.body
          ? new Uint8Array(await input.clone().arrayBuffer())
          : undefined;
    if (requestBody) {
      requestInit.body = requestBody;
    }
    const requested = await dispatcher.request(requestInit);
    const responseHeaders = new Headers();
    for (const [key, value] of Object.entries(requested.headers)) {
      if (typeof value === 'string') {
        responseHeaders.set(key, value);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          responseHeaders.append(key, item);
        }
      }
    }
    return new Response(nodeReadableToWebStream(requested.body), {
      status: requested.statusCode,
      headers: responseHeaders
    });
  };
}
