import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  ProviderUrlPolicyError,
  createPinnedProviderFetch,
  pinProviderDestination,
  validateProviderBaseUrl,
  type ProviderAddressResolver
} from './provider-url-policy';
import { listenOnFetchSafeLoopback } from '../../../../test-harness/safe-loopback-server.mjs';

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
    await rejects('ftp://8.8.8.8/v1', 'public');
    await rejects('https://0.0.0.0/v1', 'public');
    await rejects('https://10.0.0.8/v1', 'public');
    await rejects('https://100.64.0.8/v1', 'public');
    await rejects('https://127.0.0.1/v1', 'public');
    await rejects('https://169.254.169.254/latest', 'public');
    await rejects('https://224.0.0.1/v1', 'public');
    await rejects('https://[fe80::1]/v1', 'public');
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

  it('classifies IPv6 6to4 and NAT64 by the embedded IPv4 and blocks Teredo', async () => {
    await expect(
      validateProviderBaseUrl('https://[2002:808:808::]/v1', 'public')
    ).resolves.toMatchObject({ protocol: 'https:' });
    await rejects('https://[2002:a9fe:a9fe::]/latest', 'public');
    await rejects('https://[2002:a9fe:a9fe::]/latest', 'private');
    await rejects('https://[64:ff9b::a9fe:a9fe]/latest', 'public');
    await rejects('http://[2002:7f00:1::]/v1', 'private');
    await rejects('https://[2001:0:53aa:64c::]/v1', 'public');
  });

  // Break: URL credentials or one unsafe DNS answer are accepted.
  it('rejects credentials and mixed DNS answers', async () => {
    await rejects('https://user:password@8.8.8.8/v1', 'public');
    await rejects('https://8.8.8.8/v1?api_key=secret', 'public');
    await rejects('https://8.8.8.8/v1#secret', 'public');
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

  // Break: DNS is resolved again after validation or the original hostname is lost for Host/TLS SNI.
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
    const address = await listenOnFetchSafeLoopback(server);
    const fetchPinned = createPinnedProviderFetch('loopback', async () => [
      { address: '127.0.0.1' }
    ]);
    const response = await fetchPinned(
      `http://provider.example:${address.port}/v1/models`,
      { headers: { host: 'attacker.example' } }
    );
    server.close();
    expect(response.status).toBe(200);
    expect(seen[0]).toContain(`provider.example:${address.port}`);
  });

  it('forwards a POST body carried by a Request input', async () => {
    let receivedBody = '';
    const server = createServer((request, response) => {
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        receivedBody += chunk;
      });
      request.on('end', () => {
        response.statusCode = 200;
        response.end('ok');
      });
    });
    const address = await listenOnFetchSafeLoopback(server);
    const fetchPinned = createPinnedProviderFetch('loopback');

    try {
      const response = await fetchPinned(new Request(`${address.url}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"model":"manual-model"}'
      }));

      expect(response.status).toBe(200);
      expect(receivedBody).toBe('{"model":"manual-model"}');
    } finally {
      server.close();
    }
  });

  it('aborts a pinned request when the caller cancels it', async () => {
    const server = createServer(() => undefined);
    const address = await listenOnFetchSafeLoopback(server);
    const fetchPinned = createPinnedProviderFetch('loopback');
    const controller = new AbortController();

    try {
      const pending = fetchPinned(`${address.url}/models`, { signal: controller.signal });
      controller.abort();
      await expect(pending).rejects.toThrow();
    } finally {
      server.close();
    }
  });
});
