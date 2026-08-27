import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export interface ServerDatabaseConfig {
  url: string;
  serviceRoleKey: string;
}

export function createServerDatabaseClient(
  config: ServerDatabaseConfig
): SupabaseClient<Database> {
  if (!config.url) {
    throw new Error('SUPABASE_URL is required');
  }
  if (!config.serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  }

  return createClient<Database>(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
}
