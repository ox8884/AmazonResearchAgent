import { ServerConfigurationError } from './database';

export class DashboardQueryError extends Error {
  constructor(query: string, cause?: unknown) {
    super(`Could not load ${query}.`, { cause });
    this.name = 'DashboardQueryError';
  }
}

export async function safe<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof ServerConfigurationError || error instanceof DashboardQueryError) {
      return fallback;
    }
    throw error;
  }
}
