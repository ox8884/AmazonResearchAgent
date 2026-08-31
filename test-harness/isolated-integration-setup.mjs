import { inject } from 'vitest';

process.env.SUPABASE_URL = inject('isolatedSupabaseUrl');
process.env.SUPABASE_SERVICE_ROLE_KEY = inject('isolatedServiceRoleKey');
process.env.TEST_DATABASE_URL = inject('isolatedDatabaseUrl');
