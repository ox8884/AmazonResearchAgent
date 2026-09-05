import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listenOnFetchSafeLoopback } from '../../../../test-harness/safe-loopback-server.mjs';
import { getCandidateStateCounts, getJobCounts } from './dashboard-data-operations';

describe('dashboard exact counts', () => {
  let server: Server | undefined;

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (server) await new Promise<void>((resolve, reject) => {
      server?.close((error) => error ? reject(error) : resolve());
    });
  });

  async function serveCounts() {
    server = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.url?.startsWith('/rest/v1/rpc/get_dashboard_counts')) {
        let body = '';
        for await (const chunk of request) body += String(chunk);
        const input: unknown = JSON.parse(body);
        const entity = typeof input === 'object' && input !== null && 'entity' in input ? input.entity : undefined;
        response.end(JSON.stringify(entity === 'jobs'
          ? { queued: 1205, completed: 7 }
          : { Discovered: 1206, 'Needs Review': 2 }));
        return;
      }
      const row = request.url?.startsWith('/rest/v1/jobs') ? { status: 'queued' } : { state: 'Discovered' };
      response.end(JSON.stringify(Array.from({ length: 1000 }, () => row)));
    });
    const address = await listenOnFetchSafeLoopback(server);
    vi.stubEnv('SUPABASE_URL', address.url);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'local-dashboard-fixture');
  }

  it('counts jobs beyond a REST list response limit', async () => {
    await serveCounts();
    expect(await getJobCounts()).toEqual({ queued: 1205, running: 0, failed: 0, completed: 7 });
  });

  it('counts candidates beyond a REST list response limit', async () => {
    await serveCounts();
    expect(await getCandidateStateCounts()).toEqual({ Discovered: 1206, 'Needs Review': 2 });
  });
});
