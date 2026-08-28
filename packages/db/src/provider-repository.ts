import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from './types';

export type ProviderRow = Database['public']['Tables']['ai_providers']['Row'];
export type ProviderInsert = Database['public']['Tables']['ai_providers']['Insert'];
export type ModelRow = Database['public']['Tables']['ai_models']['Row'];
export type ModelInsert = Database['public']['Tables']['ai_models']['Insert'];
export type ProviderSecretRow = Database['public']['Tables']['provider_secrets']['Row'];
export type ProviderSecretInsert = Database['public']['Tables']['provider_secrets']['Insert'];

export class ProviderRepositoryError extends Error {
  constructor(operation: string, cause?: unknown) {
    super(`Could not ${operation}.`, { cause });
    this.name = 'ProviderRepositoryError';
  }
}

function savedProviderFromRpc(value: Json): ProviderRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProviderRepositoryError('load saved provider settings');
  }
  const id = value.id;
  const name = value.name;
  const kind = value.kind;
  const billingType = value.billing_type;
  const enabled = value.enabled;
  const priority = value.priority;
  const config = value.config;
  const settingsRevision = value.settings_revision;
  const createdAt = value.created_at;
  const updatedAt = value.updated_at;
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof kind !== 'string' ||
    typeof billingType !== 'string' ||
    typeof enabled !== 'boolean' ||
    typeof priority !== 'number' ||
    config === undefined ||
    typeof settingsRevision !== 'number' ||
    typeof createdAt !== 'string' ||
    typeof updatedAt !== 'string'
  ) {
    throw new ProviderRepositoryError('load saved provider settings');
  }
  return {
    id,
    name,
    kind,
    billing_type: billingType,
    enabled,
    priority,
    config,
    settings_revision: settingsRevision,
    created_at: createdAt,
    updated_at: updatedAt
  };
}


export interface ProviderRepository {
  listProviders(): Promise<readonly ProviderRow[]>;
  findProvider(id: string): Promise<ProviderRow | null>;
  listModels(providerId?: string): Promise<readonly ModelRow[]>;
  listSecrets(): Promise<readonly ProviderSecretRow[]>;
  findSecret(providerId: string): Promise<ProviderSecretRow | null>;
  upsertProvider(input: ProviderInsert): Promise<ProviderRow>;
  upsertModel(input: ModelInsert): Promise<ModelRow>;
  upsertSecret(input: ProviderSecretInsert): Promise<ProviderSecretRow>;
  saveSettings(input: {
    readonly provider: ProviderInsert;
    readonly secret: ProviderSecretInsert | null;
    readonly models: readonly ModelInsert[];
    readonly reconcileMode: 'none' | 'manual' | 'discovery' | 'status';
    readonly modelStatus?: readonly {
      readonly modelId: string;
      readonly enabled: boolean;
      readonly priority: number;
    }[];
    readonly expectedRevision?: number | null;
  }): Promise<ProviderRow>;
  recordExecutionProbe(input: {
    readonly providerId: string;
    readonly expectedFingerprint: string;
    readonly probe: Json;
  }): Promise<boolean>;

}

export function createProviderRepository(
  client: Pick<SupabaseClient<Database>, 'rpc' | 'from'>
): ProviderRepository {

  return {
    async listProviders() {
      const { data, error } = await client
        .from('ai_providers')
        .select('*')
        .order('priority', { ascending: true })
        .order('name', { ascending: true });
      if (error) {
        throw new ProviderRepositoryError('list AI providers', error);
      }
      return data;
    },

    async findProvider(id) {
      const { data, error } = await client
        .from('ai_providers')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) {
        throw new ProviderRepositoryError('find the AI provider', error);
      }
      return data;
    },

    async listModels(providerId) {
      let query = client
        .from('ai_models')
        .select('*')
        .order('priority', { ascending: true })
        .order('quality_rank', { ascending: true });
      if (providerId) {
        query = query.eq('provider_id', providerId);
      }
      const { data, error } = await query;
      if (error) {
        throw new ProviderRepositoryError('list AI models', error);
      }
      return data;
    },

    async listSecrets() {
      const { data, error } = await client
        .from('provider_secrets')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) {
        throw new ProviderRepositoryError('list provider secret metadata', error);
      }
      return data;
    },

    async findSecret(providerId) {
      const { data, error } = await client
        .from('provider_secrets')
        .select('*')
        .eq('provider_id', providerId)
        .maybeSingle();
      if (error) {
        throw new ProviderRepositoryError('find provider secret metadata', error);
      }
      return data;
    },

    async upsertProvider(input) {
      const { data, error } = await client
        .from('ai_providers')
        .upsert(input)
        .select('*')
        .single();
      if (error || !data) {
        throw new ProviderRepositoryError('save the AI provider', error);
      }
      return data;
    },

    async upsertModel(input) {
      const { data, error } = await client
        .from('ai_models')
        .upsert(input, { onConflict: 'provider_id,model_id' })
        .select('*')
        .single();
      if (error || !data) {
        throw new ProviderRepositoryError('save the AI model', error);
      }
      return data;
    },

    async upsertSecret(input) {
      const { data, error } = await client
        .from('provider_secrets')
        .upsert(input)
        .select('*')
        .single();
      if (error || !data) {
        throw new ProviderRepositoryError('save provider secret metadata', error);
      }
      return data;
    },

    async saveSettings(input) {
      const { data, error } = await client.rpc('save_ai_provider_settings', {
        provider_row: input.provider,
        secret_row: input.secret,
        models: [...input.models],
        reconcile_mode: input.reconcileMode,
        model_status: (input.modelStatus ?? []).map((model) => ({
          model_id: model.modelId,
          enabled: model.enabled,
          priority: model.priority
        })),
        expected_revision: input.expectedRevision ?? null
      });
      if (error || data === null) {
        throw new ProviderRepositoryError('save provider settings atomically', error);
      }
      return savedProviderFromRpc(data);
    },


    async recordExecutionProbe(input) {
      const { data, error } = await client.rpc('record_ai_provider_execution_probe', {
        provider_id: input.providerId,
        expected_fingerprint: input.expectedFingerprint,
        probe: input.probe
      });
      if (error) {
        throw new ProviderRepositoryError('record provider execution probe', error);
      }
      return data === true;
    }

  };
}
