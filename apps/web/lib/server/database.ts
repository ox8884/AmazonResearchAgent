import { createServerDatabaseClient } from '@ara/db';
import { z } from 'zod';

const ServerEnvironmentSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_STORAGE_BUCKET: z.string().trim().min(1).default('opportunity-imports')
});

export class ServerConfigurationError extends Error {
  constructor(cause: z.ZodError) {
    super('Supabase server configuration is incomplete.', { cause });
    this.name = 'ServerConfigurationError';
  }
}

export function getServerDatabaseContext() {
  const parsedEnvironment = ServerEnvironmentSchema.safeParse(process.env);
  if (!parsedEnvironment.success) {
    throw new ServerConfigurationError(parsedEnvironment.error);
  }
  const environment = parsedEnvironment.data;
  return {
    client: createServerDatabaseClient({
      url: environment.SUPABASE_URL,
      serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY
    }),
    storageBucket: environment.SUPABASE_STORAGE_BUCKET
  };
}
