import { createServerDatabaseClient } from '@ara/db';
import { describe, expect, it } from 'vitest';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const integration = supabaseUrl && serviceRoleKey ? describe : describe.skip;

integration('normalization coordinator authority cutover', () => {
  // Break: service_role keeps the temporary legacy cluster mutation capability after Task 10.
  it('denies the legacy cluster helper to service_role', async () => {
    const client = createServerDatabaseClient({
      url: supabaseUrl ?? '',
      serviceRoleKey: serviceRoleKey ?? ''
    });
    const { error } = await client.rpc('upsert_niche_cluster', {
      canonical_key: 'task-10-legacy-helper-must-fail',
      canonical_name: 'Task 10 Legacy Helper Must Fail',
      canonical_english: 'Task 10 Legacy Helper Must Fail',
      aliases: [],
      catalog_phrases: [],
      cluster_state: 'Ready for API Validation'
    });
    expect(error?.message).toMatch(/permission denied/u);
  });
});
