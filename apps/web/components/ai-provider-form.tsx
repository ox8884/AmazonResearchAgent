'use client';

import {
  AiRoleSchema,
  BillingTypeSchema,
  getCopy,
  ProviderKindSchema,
  type Locale
} from '@ara/shared';
import ky from 'ky';
import { useEffect, useState, type FormEvent } from 'react';
import { adminCsrfHeaders } from '../lib/admin-csrf';
import { providerFormKey } from './ai-provider-form-key';
import { z } from 'zod';


const ProviderModelSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  billingType: BillingTypeSchema,
  capabilities: z.array(z.string()),
  qualityRank: z.number(),
  enabled: z.boolean().default(true),
  priority: z.number().default(100),
  origin: z.string().default('manual')
});

const SavedProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: ProviderKindSchema,
  billingType: BillingTypeSchema,
  enabled: z.boolean(),
  priority: z.number().default(100),
  secretLast4: z.string().nullable(),
  roles: z.array(z.string()).default([]),
  baseUrl: z.string().nullable().optional(),
  networkScope: z.enum(['public', 'private', 'loopback']).nullable().optional(),
  commandProfileId: z.string().nullable().optional(),
  modelId: z.string().nullable().optional(),
  modelDiscovery: z.enum(['enabled', 'disabled']).default('enabled'),
  settingsRevision: z.number().default(1),
  models: z.array(ProviderModelSchema)
});

const ProviderResponseSchema = z.object({
  provider: SavedProviderSchema
});


const ProviderListSchema = z.object({
  providers: z.array(SavedProviderSchema)
});
const ConnectionJobResponseSchema = z.object({
  jobId: z.string(),
  status: z.literal('queued')
});

const ConnectionResultSchema = z.object({
  jobId: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  result: z.unknown(),
  errorCategory: z.string().nullable()
});

type FormStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'testing' }
  | { readonly kind: 'tested'; readonly available: boolean; readonly models: readonly string[] };

type SavedProvider = z.infer<typeof SavedProviderSchema>;

function delay(milliseconds: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, milliseconds);
  return promise;
}

function providerResult(value: unknown): {
  readonly available: boolean;
  readonly models: readonly string[];
} | null {
  if (typeof value !== 'object' || value === null || !('providerTest' in value)) {
    return null;
  }
  const providerTest = value.providerTest;
  if (
    typeof providerTest !== 'object' ||
    providerTest === null ||
    !('available' in providerTest) ||
    !('models' in providerTest) ||
    typeof providerTest.available !== 'boolean' ||
    !Array.isArray(providerTest.models) ||
    !providerTest.models.every((model) => typeof model === 'string')
  ) {
    return null;
  }
  return {
    available: providerTest.available,
    models: providerTest.models
  };
}

async function waitForProviderTest(jobId: string): Promise<{
  readonly available: boolean;
  readonly models: readonly string[];
}> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = ConnectionResultSchema.parse(
      await ky
        .get(`/api/ai-provider-tests/${encodeURIComponent(jobId)}`, {
          credentials: 'same-origin'
        })
        .json<unknown>()
    );
    const result = providerResult(response.result);
    if (response.status === 'completed' && result) {
      return result;
    }
    if (response.status === 'failed') {
      return { available: false, models: [] };
    }
    await delay(500);
  }
  return { available: false, models: [] };
}

export function AiProviderForm({ locale }: { locale: Locale }) {
  const copy = getCopy(locale);
  const [providers, setProviders] = useState<readonly SavedProvider[]>([]);
  const [saved, setSaved] = useState<SavedProvider | null>(null);
  const [status, setStatus] = useState<FormStatus>({ kind: 'idle' });

  async function loadProviders(): Promise<void> {
    const result = ProviderListSchema.parse(
      await ky.get('/api/ai-providers', { credentials: 'same-origin' }).json<unknown>()
    );
    setProviders(result.providers);
  }

  useEffect(() => {
    void loadProviders().catch((error: unknown) => {
      if (error instanceof Error) {
        setStatus({ kind: 'error', message: copy.connectionUnavailable });
        return;
      }
      throw error;
    });
  }, [copy.connectionUnavailable]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStatus({ kind: 'saving' });
    const form = event.currentTarget;
    const formData = new FormData(form);
    const submittedModelId =
      typeof formData.get('modelId') === 'string' ? String(formData.get('modelId')).trim() : '';
    const isNewManual =
      submittedModelId.length > 0 && submittedModelId !== (saved?.modelId ?? '');
    const body = {
      id: formData.get('id') || undefined,
      name: formData.get('name') ?? '',
      kind: formData.get('kind') ?? 'openai_http',
      billingType: formData.get('billingType') ?? 'subscription',
      baseUrl: formData.get('baseUrl') ?? '',
      networkScope: formData.get('networkScope') ?? 'public',
      apiKey: formData.get('apiKey') ?? '',
      modelId: submittedModelId,
      modelDiscovery: isNewManual
        ? 'disabled'
        : (saved?.modelDiscovery ?? (submittedModelId ? 'disabled' : 'enabled')),
      modelEnabled: isNewManual ? true : formData.get('modelEnabled') === 'on',
      modelPriority: isNewManual ? 100 : Number(formData.get('modelPriority') ?? 100),
      commandProfileId: formData.get('commandProfileId') ?? '',
      roles: formData
        .getAll('roles')
        .filter((value): value is string => typeof value === 'string'),
      enabled: formData.get('enabled') === 'on',
      priority: Number(formData.get('priority') ?? 100),
      settingsRevision: saved?.settingsRevision,
      models: (saved?.models ?? []).map((model) => ({
        modelId: model.id,
        enabled: formData.get(`model-enabled-${model.id}`) === 'on',
        priority: Number(formData.get(`model-priority-${model.id}`) ?? model.priority)
      }))
    };

    try {
      const result = ProviderResponseSchema.parse(
        await ky.post('/api/ai-providers', {
          json: body,
          headers: adminCsrfHeaders(),
          credentials: 'same-origin'
        }).json<unknown>()
      );
      setSaved(result.provider);
      setStatus({ kind: 'saved' });
      await loadProviders();
    } catch (error) {
      if (error instanceof Error) {
        setStatus({ kind: 'error', message: copy.connectionUnavailable });
        return;
      }
      throw error;
    }
  }

  async function testConnection(): Promise<void> {
    if (!saved || status.kind === 'testing') {
      return;
    }
    setStatus({ kind: 'testing' });
    try {
      const queued = ConnectionJobResponseSchema.parse(
        await ky
          .post('/api/ai-providers/test', {
            json: { providerId: saved.id },
            headers: adminCsrfHeaders(),
            credentials: 'same-origin'
          })
          .json<unknown>()
      );
      const result = await waitForProviderTest(queued.jobId);
      const listed = ProviderListSchema.parse(
        await ky.get('/api/ai-providers', { credentials: 'same-origin' }).json<unknown>()
      );
      setProviders(listed.providers);
      const refreshed = listed.providers.find((provider) => provider.id === saved.id);
      if (refreshed) {
        setSaved(refreshed);
      }
      setStatus({
        kind: 'tested',
        available: result.available,
        models: result.models
      });

    } catch (error) {
      if (error instanceof Error) {
        setStatus({ kind: 'error', message: copy.connectionUnavailable });
        return;
      }
      throw error;
    }
  }

  const errorMessage = status.kind === 'error' ? status.message : null;
  const isSaving = status.kind === 'saving';
  const selectedRoles = saved?.roles ?? ['niche_normalization'];

  return (
    <div className="provider-admin">
      <section className="provider-list" aria-labelledby="saved-providers-title">
        <h2 id="saved-providers-title">{copy.aiSettingsTitle}</h2>
        {providers.length === 0 ? (
          <p>{copy.noProviders}</p>
        ) : (
          <ul>
            {providers.map((provider) => (
              <li key={provider.id}>
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => {
                    setSaved(provider);
                    setStatus({ kind: 'idle' });
                  }}
                >
                  {provider.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form className="ai-provider-form" onSubmit={submit} key={providerFormKey(saved)}>

        {saved ? <input type="hidden" name="id" value={saved.id} /> : null}
        <div className="form-grid">
          <div className="field-stack">
            <label htmlFor="provider-name">{copy.providerName}</label>
            <input
              id="provider-name"
              name="name"
              required
              autoComplete="off"
              defaultValue={saved?.name ?? ''}
            />
          </div>
          <div className="field-stack">
            <label htmlFor="provider-kind">{copy.providerKind}</label>
            <select id="provider-kind" name="kind" defaultValue={saved?.kind ?? 'openai_http'}>
              <option value="openai_http">OpenAI-compatible HTTP</option>
              <option value="command">Command provider</option>
            </select>
          </div>
          <div className="field-stack">
            <label htmlFor="billing-type">{copy.billingType}</label>
            <select
              id="billing-type"
              name="billingType"
              defaultValue={saved?.billingType ?? 'subscription'}
            >
              <option value="free">Free</option>
              <option value="subscription">Subscription</option>
              <option value="payg">Pay-as-you-go</option>
            </select>
          </div>
          <label className="checkbox-field">
            <input
              name="enabled"
              type="checkbox"
              defaultChecked={saved?.enabled ?? true}
            />
            <span>{copy.providerEnabled}</span>
          </label>
          <div className="field-stack">
            <label htmlFor="provider-priority">{copy.providerPriority}</label>
            <input
              id="provider-priority"
              name="priority"
              type="number"
              min={0}
              defaultValue={saved?.priority ?? 100}
            />
          </div>
          <div className="field-stack">
            <label htmlFor="model-id">{copy.modelId}</label>
            <input
              id="model-id"
              name="modelId"
              placeholder="model-id"
              defaultValue={saved?.modelId ?? ''}
            />
          </div>
          {(saved?.models ?? []).map((model) => (
            <div key={model.id} className="field-stack field-stack--wide">
              <label className="checkbox-field">
                <input
                  name={`model-enabled-${model.id}`}
                  type="checkbox"
                  defaultChecked={model.enabled}
                />
                <span>
                  {copy.modelEnabled}: {model.displayName} ({model.origin})
                </span>
              </label>
              <label htmlFor={`model-priority-${model.id}`}>{copy.modelPriority}</label>
              <input
                id={`model-priority-${model.id}`}
                name={`model-priority-${model.id}`}
                type="number"
                min={0}
                defaultValue={model.priority}
              />
            </div>
          ))}
          {(!saved || saved.models.length === 0) && (
            <>
              <label className="checkbox-field">
                <input
                  name="modelEnabled"
                  type="checkbox"
                  defaultChecked
                />
                <span>{copy.modelEnabled}</span>
              </label>
              <div className="field-stack">
                <label htmlFor="model-priority">{copy.modelPriority}</label>
                <input
                  id="model-priority"
                  name="modelPriority"
                  type="number"
                  min={0}
                  defaultValue={100}
                />
              </div>
            </>
          )}

          <div className="field-stack field-stack--wide">
            <label htmlFor="base-url">{copy.baseUrl}</label>
            <input
              id="base-url"
              name="baseUrl"
              type="url"
              placeholder="https://provider.example/v1"
              defaultValue={saved?.baseUrl ?? ''}
            />
          </div>
          <div className="field-stack">
            <label htmlFor="network-scope">{copy.networkScope}</label>
            <select
              id="network-scope"
              name="networkScope"
              defaultValue={saved?.networkScope ?? 'public'}
            >
              <option value="public">Public HTTPS</option>
              <option value="private">Private / Tailscale</option>
              <option value="loopback">Worker loopback</option>
            </select>
          </div>
          <div className="field-stack">
            <label htmlFor="command-profile">{copy.commandProfile}</label>
            <select
              id="command-profile"
              name="commandProfileId"
              defaultValue={saved?.commandProfileId ?? ''}
            >
              <option value="">None</option>
              <option value="fake-command">Fake command (local test only)</option>
            </select>
          </div>
          <div className="field-stack field-stack--wide">
            <label htmlFor="api-key">{copy.apiKey}</label>
            <input id="api-key" name="apiKey" type="password" autoComplete="new-password" />
          </div>
          <fieldset className="field-stack field-stack--wide role-assignments">
            <legend>{copy.roleAssignments}</legend>
            {AiRoleSchema.options.map((role) => (
              <label className="checkbox-field" key={role}>
                <input
                  name="roles"
                  type="checkbox"
                  value={role}
                  defaultChecked={selectedRoles.includes(role)}
                />
                <span>{role}</span>
              </label>
            ))}
          </fieldset>
        </div>

        <p className="privacy-note">{copy.privacyNote}</p>
        <button className="button button--primary" type="submit" disabled={isSaving}>
          {isSaving ? copy.uploadingFiles : copy.saveProvider}
        </button>

        {errorMessage ? <p className="notice notice--error" role="alert">{errorMessage}</p> : null}
        {saved ? (
          <section className="provider-result" aria-labelledby="saved-provider-title">
            <h2 id="saved-provider-title">{saved.name}</h2>
            {status.kind === 'saved' ? <p role="status">{copy.providerSaved}</p> : null}
            {saved.secretLast4 ? (
              <p className="import-id">
                <span>{copy.secretStored}</span> <code>••••{saved.secretLast4}</code>
              </p>
            ) : null}
            <button
              className="button button--secondary"
              type="button"
              onClick={testConnection}
              disabled={status.kind === 'testing'}
            >
              {status.kind === 'testing' ? copy.uploadingFiles : copy.testConnection}
            </button>
            {status.kind === 'tested' ? (
              <p
                className={status.available ? 'notice notice--success' : 'notice notice--error'}
                role="status"
              >
                {status.available ? copy.connectionReady : copy.connectionUnavailable}
                {status.models.length > 0 ? ` · ${status.models.join(', ')}` : ''}
              </p>
            ) : null}
          </section>
        ) : null}
      </form>
    </div>
  );
}
