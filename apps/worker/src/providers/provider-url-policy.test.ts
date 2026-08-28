import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  ProviderUrlPolicyError,
  createPinnedProviderFetch,
  pinProviderDestination,
  validateProviderBaseUrl,
  type ProviderAddressResolver
} from './provider-url-policy';

function resolver(...addresses: readonly string[]): ProviderAddressResolver {
  return async () => addresses.map((address) => ({ address }));
}

async function rejects(
  value: string,
  scope: 'public' | 'private' | 'loopback',
  resolveAddress?: ProviderAddressResolver
): Promise<void> {
  await expect(
    validateProviderBaseUrl(value, scope, resolveAddress)
  ).rejects.toBeInstanceOf(ProviderUrlPolicyError);
}

describe('worker provider URL policy', () => {
  // Break: a public provider can target an HTTP, RFC1918, Tailscale, loopback, or metadata endpoint.
  it('restricts public providers to HTTPS destinations with only public addresses', async () => {
    await expect(
      validateProviderBaseUrl('https://8.8.8.8/v1', 'public')
    ).resolves.toMatchObject({ protocol: 'https:' });

    await rejects('http://8.8.8.8/v1', 'public');
    await rejects('https://10.0.0.8/v1', 'public');
    await rejects('https://100.64.0.8/v1', 'public');
    await rejects('https://127.0.0.1/v1', 'public');
    await rejects('https://169.254.169.254/latest', 'public');
  });

  // Break: private/Tailscale providers become unusable, or private scope can reach worker loopback.
  it('allows private and Tailscale addresses but rejects loopback', async () => {
    await expect(
      validateProviderBaseUrl('http://10.0.0.8/v1', 'private')
    ).resolves.toMatchObject({ protocol: 'http:' });
    await expect(
      validateProviderBaseUrl('http://100.64.0.8/v1', 'private')
    ).resolves.toMatchObject({ protocol: 'http:' });

    await rejects('http://127.0.0.1/v1', 'private');
    await rejects('http://[::1]/v1', 'private');
  });

  // Break: loopback profiles cannot use IPv6, or mapped IPv6 bypasses the selected scope.
  it('accepts only local addresses for loopback scope, including IPv6 loopback', async () => {
    await expect(
      validateProviderBaseUrl('http://127.0.0.1/v1', 'loopback')
    ).resolves.toMatchObject({ hostname: '127.0.0.1' });
    await expect(
      validateProviderBaseUrl('http://[::1]/v1', 'loopback')
    ).resolves.toMatchObject({ hostname: '[::1]' });

    await rejects('http://10.0.0.8/v1', 'loopback');
    await rejects('https://[::ffff:127.0.0.1]/v1', 'public');
  });

  // Break: URL credentials or one unsafe DNS answer are accepted.
  it('rejects credentials and mixed DNS answers', async () => {
    await rejects('https://user:password@8.8.8.8/v1', 'public');
    await rejects(
      'https://provider.example/v1',
      'public',
      resolver('8.8.8.8', '10.0.0.8')
    );
  });

  // Break: metadata endpoints are reachable through a permissive private scope.
  it('blocks metadata addresses in every scope', async () => {
    await rejects('http://169.254.169.254/latest', 'private');
    await rejects('http://100.100.100.200/latest', 'private');
    await rejects('http://[fd00:ec2::254]/latest', 'private');
  });

  it('pins the connect host to the lookup used for validation', async () => {
    let lookups = 0;
    const resolve: ProviderAddressResolver = async () => {
      lookups += 1;
      return lookups === 1 ? [{ address: '8.8.8.8' }] : [{ address: '127.0.0.1' }];
    };
    const pinned = await pinProviderDestination(
      'https://provider.example/v1',
      'public',
      resolve
    );
    expect(pinned.connectHost).toBe('8.8.8.8');
    expect(pinned.tlsServername).toBe('provider.example');
    expect(pinned.hostnameHeader).toBe('provider.example');
    expect(lookups).toBe(1);
  });

  it('connects to the validated IP while sending the original Host header', async () => {
    const seen: string[] = [];
    const server = createServer((request, response) => {
      seen.push(`${request.socket.remoteAddress ?? ''}|${request.headers.host ?? ''}`);
      response.statusCode = 200;
      response.end('{"ok":true}');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const fetchPinned = createPinnedProviderFetch('loopback', async () => [
      { address: '127.0.0.1' }
    ]);
    const response = await fetchPinned(
      `http://provider.example:${address.port}/v1/models`
    );
    server.close();
    expect(response.status).toBe(200);
    expect(seen[0]).toContain(`provider.example:${address.port}`);
  });
});
