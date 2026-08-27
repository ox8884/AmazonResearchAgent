import { describe, expect, it } from 'vitest';
import { createServerDatabaseClient } from './client';

describe('server database client', () => {
  // Break: a server client is created without a configured Supabase URL.
  it('requires the server URL', () => {
    expect(() =>
      createServerDatabaseClient({ url: '', serviceRoleKey: 'test-key' })
    ).toThrow('SUPABASE_URL is required');
  });

  // Break: the database client silently falls back to a browser-visible key.
  it('requires an explicit service-role key', () => {
    expect(() =>
      createServerDatabaseClient({
        url: 'http://127.0.0.1:54321',
        serviceRoleKey: ''
      })
    ).toThrow('SUPABASE_SERVICE_ROLE_KEY is required');
  });

  // Break: valid server-only configuration cannot construct the typed adapter.
  it('constructs a client without making a network request', () => {
    const client = createServerDatabaseClient({
      url: 'http://127.0.0.1:54321',
      serviceRoleKey: 'local-test-key'
    });

    expect(client).toBeDefined();
  });
});
