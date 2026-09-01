'use client';

import {
  AiRoleSchema,
  BillingTypeSchema,
  getCopy,
  type Locale
} from '@ara/shared';
import {
  AI_PROVIDER_PRODUCT_OPTIONS,
  aiProviderProductFields,
  type AiProviderProduct
} from '../../../packages/shared/src/i18n';
import ky from 'ky';
import { useEffect, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { adminCsrfHeaders } from '../lib/admin-csrf';
import { providerFormKey as buildProviderFormKey } from './ai-provider-form-key';

export const PRODUCT_PROVIDER_OPTIONS = AI_PROVIDER_PRODUCT_OPTIONS;
export const productFieldVisibility = aiProviderProductFields;

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

const HttpProviderSchema = z.object({
  id: z.string(),
  product: z.literal('openai_compatible_api'),
  productLabel: z.string(),
  name: z.string(),
  billingType: BillingTypeSchema,
  enabled: z.boolean(),
  priority: z.number().default(100),
  secretLast4: z.string().nullable(),
  roles: z.array(z.string()).default([]),
  baseUrl: z.string().nullable(),
  networkScope: z.enum(['public', 'private', 'loopback']).nullable(),
  modelId: z.string().nullable(),
  modelDiscovery: z.enum(['enabled', 'disabled']).default('enabled'),
  settingsRevision: z.number().default(1),
  models: z.array(ProviderModelSchema)
});

const SubscriptionStatusSchema = z.enum([
  'setup_required',
  'disabled',
  'ready',
  'expired',
  'needs_attention',
  'unavailable'
]);

const SubscriptionReasonSchema = z.enum([
  'setup_required',
  'authorization_expired',
  'probe_pending',
  'temporarily_unavailable',
  'disabled'
]);

const SubscriptionProviderSchema = z.object({
  id: z.string(),
  product: z.enum(['codex_subscription', 'grok_subscription']),
  productLabel: z.string(),
  name: z.string(),
  billingType: z.literal('subscription'),
  enabled: z.boolean(),
  priority: z.number().default(100),
  role: z.literal('niche_normalization'),
  modelLabel: z.string(),
  setupStatus: SubscriptionStatusSchema,
  statusReason: SubscriptionReasonSchema.nullable(),
  lastCheckedAt: z.string().nullable(),
  settingsRevision: z.number().default(1)
});

const SavedProviderSchema = z.discriminatedUnion('product', [
  HttpProviderSchema,
  SubscriptionProviderSchema
]);
const ProviderResponseSchema = z.object({ provider: SavedProviderSchema });
const ProviderListSchema = z.object({ providers: z.array(SavedProviderSchema) });
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

type SavedProvider = z.infer<typeof SavedProviderSchema>;
type HttpProvider = z.infer<typeof HttpProviderSchema>;
type SubscriptionProvider = z.infer<typeof SubscriptionProviderSchema>;
type FormStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'testing' }
  | {
      readonly kind: 'tested';
      readonly providerId: string;
      readonly available: boolean;
      readonly models: readonly string[];
    };

function delay(milliseconds: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, milliseconds);
  return promise;
}

function providerResult(value: unknown): {
  readonly available: boolean;
  readonly models: readonly string[];
} | null {
  if (typeof value !== 'object' || value === null || !('providerTest' in value)) return null;
  const providerTest = value.providerTest;
  if (
    typeof providerTest !== 'object' ||
    providerTest === null ||
    !('available' in providerTest) ||
    !('models' in providerTest) ||
    typeof providerTest.available !== 'boolean' ||
    !Array.isArray(providerTest.models) ||
    !providerTest.models.every((model) => typeof model === 'string')
  ) return null;
  return { available: providerTest.available, models: providerTest.models };
}

async function waitForProviderTest(jobId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = ConnectionResultSchema.parse(
      await ky.get(`/api/ai-provider-tests/${encodeURIComponent(jobId)}`, {
        credentials: 'same-origin'
      }).json<unknown>()
    );
    const result = providerResult(response.result);
    if (response.status === 'completed' && result) return result;
    if (response.status === 'failed') return { available: false, models: [] };
    await delay(500);
  }
  return { available: false, models: [] };
}

function subscriptionStatusLabel(
  provider: SubscriptionProvider,
  copy: ReturnType<typeof getCopy>
): string {
  if (provider.setupStatus === 'ready') return copy.connectionReady;
  if (provider.setupStatus === 'expired') return copy.authorizationExpired;
  if (provider.setupStatus === 'disabled') return copy.providerDisabled;
  if (provider.setupStatus === 'needs_attention') return copy.needsAttentionLabel;
  if (provider.setupStatus === 'unavailable') return copy.connectionUnavailable;
  if (provider.statusReason === 'probe_pending') return copy.probePending;
  if (provider.statusReason === 'temporarily_unavailable') return copy.temporarilyUnavailable;
  return copy.setupRequired;
}

export function AiProviderForm({ locale }: { locale: Locale }) {
  const copy = getCopy(locale);
  const [providers, setProviders] = useState<readonly SavedProvider[]>([]);
  const [saved, setSaved] = useState<SavedProvider | null>(null);
  const [product, setProduct] = useState<AiProviderProduct>('codex_subscription');
  const [status, setStatus] = useState<FormStatus>({ kind: 'idle' });

  async function loadProviders(): Promise<readonly SavedProvider[]> {
    const result = ProviderListSchema.parse(
      await ky.get('/api/ai-providers', { credentials: 'same-origin' }).json<unknown>()
    );
    setProviders(result.providers);
    return result.providers;
  }

  useEffect(() => {
    void loadProviders()
      .then((loaded) => {
        const first = loaded[0];
        if (first) {
          setSaved(first);
          setProduct(first.product);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof Error) {
          setStatus({ kind: 'error', message: copy.connectionUnavailable });
          return;
        }
        throw error;
      });
  }, [copy.connectionUnavailable]);

  function selectProvider(provider: SavedProvider): void {
    setSaved(provider);
    setProduct(provider.product);
    setStatus({ kind: 'idle' });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStatus({ kind: 'saving' });
    const formData = new FormData(event.currentTarget);
    const selectedProduct = String(formData.get('product')) as AiProviderProduct;
    const savedHttp = saved?.product === 'openai_compatible_api' ? saved : null;
    let body: Record<string, unknown>;
    if (selectedProduct === 'openai_compatible_api') {
      const submittedModelId = String(formData.get('modelId') ?? '').trim();
      const isNewManual = submittedModelId.length > 0 && submittedModelId !== (savedHttp?.modelId ?? '');
      body = {
        product: selectedProduct,
        id: savedHttp?.id,
        name: formData.get('name') ?? '',
        billingType: formData.get('billingType') ?? 'subscription',
        baseUrl: formData.get('baseUrl') ?? '',
        networkScope: formData.get('networkScope') ?? 'public',
        apiKey: formData.get('apiKey') ?? '',
        modelId: submittedModelId,
        modelDiscovery: isNewManual
          ? 'disabled'
          : (savedHttp?.modelDiscovery ?? (submittedModelId ? 'disabled' : 'enabled')),
        modelEnabled: isNewManual || formData.get('modelEnabled') === 'on',
        modelPriority: isNewManual ? 100 : Number(formData.get('modelPriority') ?? 100),
        roles: formData.getAll('roles').filter((value): value is string => typeof value === 'string'),
        enabled: formData.get('enabled') === 'on',
        priority: Number(formData.get('priority') ?? 100),
        settingsRevision: savedHttp?.settingsRevision,
        models: (savedHttp?.models ?? []).map((model) => ({
          modelId: model.id,
          enabled: formData.get(`model-enabled-${model.id}`) === 'on',
          priority: Number(formData.get(`model-priority-${model.id}`) ?? model.priority)
        }))
      };
    } else {
      body = {
        product: selectedProduct,
        priority: Number(formData.get('priority') ?? 100)
      };
    }
    try {
      const result = ProviderResponseSchema.parse(
        await ky.post('/api/ai-providers', {
          json: body,
          headers: adminCsrfHeaders(),
          credentials: 'same-origin'
        }).json<unknown>()
      );
      setSaved(result.provider);
      setProduct(result.provider.product);
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

  async function testConnection(provider: SavedProvider): Promise<void> {
    if (status.kind === 'testing') return;
    setStatus({ kind: 'testing' });
    try {
      const queued = ConnectionJobResponseSchema.parse(
        await ky.post('/api/ai-providers/test', {
          json: { providerId: provider.id },
          headers: adminCsrfHeaders(),
          credentials: 'same-origin'
        }).json<unknown>()
      );
      const result = await waitForProviderTest(queued.jobId);
      const listed = await loadProviders();
      const refreshed = listed.find((item) => item.id === provider.id);
      if (refreshed) selectProvider(refreshed);
      setStatus({ kind: 'tested', providerId: provider.id, available: result.available, models: result.models });
    } catch (error) {
      if (error instanceof Error) {
        setStatus({ kind: 'error', message: copy.connectionUnavailable });
        return;
      }
      throw error;
    }
  }

  async function disableSubscription(provider: SubscriptionProvider): Promise<void> {
    try {
      await ky.post('/api/ai-providers', {
        json: { action: 'disable', providerId: provider.id },
        headers: adminCsrfHeaders(),
        credentials: 'same-origin'
      });
      const listed = await loadProviders();
      const refreshed = listed.find((item) => item.id === provider.id);
      if (refreshed) selectProvider(refreshed);
    } catch (error) {
      if (error instanceof Error) {
        setStatus({ kind: 'error', message: copy.connectionUnavailable });
        return;
      }
      throw error;
    }
  }

  const savedHttp: HttpProvider | null = saved?.product === 'openai_compatible_api' ? saved : null;
  const visibility = productFieldVisibility(product);
  const errorMessage = status.kind === 'error' ? status.message : null;

  return (
    <div className="provider-admin">
      <section className="provider-list" aria-labelledby="saved-providers-title">
        <h2 id="saved-providers-title">{copy.aiSettingsTitle}</h2>
        {providers.length === 0 ? <p>{copy.noProviders}</p> : (
          <ul>
            {providers.map((provider) => (
              <li key={provider.id}>
                <button className="button button--secondary" type="button" onClick={() => selectProvider(provider)}>
                  {provider.productLabel}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form className="ai-provider-form" onSubmit={submit} key={buildProviderFormKey(saved)}>
        <div className="form-grid">
          <div className="field-stack">
            <label htmlFor="provider-product">{copy.providerProduct}</label>
            <select
              id="provider-product"
              name="product"
              value={product}
              onChange={(event) => {
                setProduct(event.target.value as AiProviderProduct);
                setSaved(null);
                setStatus({ kind: 'idle' });
              }}
            >
              {PRODUCT_PROVIDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          {visibility.httpCredentials ? (
            <>
              <div className="field-stack">
                <label htmlFor="provider-name">{copy.providerName}</label>
                <input id="provider-name" name="name" required autoComplete="off" defaultValue={savedHttp?.name ?? ''} />
              </div>
              <div className="field-stack">
                <label htmlFor="billing-type">{copy.billingType}</label>
                <select id="billing-type" name="billingType" defaultValue={savedHttp?.billingType ?? 'subscription'}>
                  <option value="free">Free</option>
                  <option value="subscription">Subscription</option>
                  <option value="payg">Pay-as-you-go</option>
                </select>
              </div>
              <label className="checkbox-field">
                <input name="enabled" type="checkbox" defaultChecked={savedHttp?.enabled ?? true} />
                <span>{copy.providerEnabled}</span>
              </label>
            </>
          ) : null}
          <div className="field-stack">
            <label htmlFor="provider-priority">{copy.providerPriority}</label>
            <input id="provider-priority" name="priority" type="number" min={0} defaultValue={saved?.priority ?? 100} />
          </div>
          {visibility.modelConfiguration ? (
            <>
              <div className="field-stack">
                <label htmlFor="model-id">{copy.modelId}</label>
                <input id="model-id" name="modelId" placeholder="model-id" defaultValue={savedHttp?.modelId ?? ''} />
              </div>
              {(savedHttp?.models ?? []).map((model) => (
                <div key={model.id} className="field-stack field-stack--wide">
                  <label className="checkbox-field">
                    <input name={`model-enabled-${model.id}`} type="checkbox" defaultChecked={model.enabled} />
                    <span>{copy.modelEnabled}: {model.displayName} ({model.origin})</span>
                  </label>
                  <label htmlFor={`model-priority-${model.id}`}>{copy.modelPriority}</label>
                  <input id={`model-priority-${model.id}`} name={`model-priority-${model.id}`} type="number" min={0} defaultValue={model.priority} />
                </div>
              ))}
              {(!savedHttp || savedHttp.models.length === 0) ? (
                <>
                  <label className="checkbox-field">
                    <input name="modelEnabled" type="checkbox" defaultChecked />
                    <span>{copy.modelEnabled}</span>
                  </label>
                  <div className="field-stack">
                    <label htmlFor="model-priority">{copy.modelPriority}</label>
                    <input id="model-priority" name="modelPriority" type="number" min={0} defaultValue={100} />
                  </div>
                </>
              ) : null}
            </>
          ) : null}
          {visibility.httpCredentials ? (
            <>
              <div className="field-stack field-stack--wide">
                <label htmlFor="base-url">{copy.baseUrl}</label>
                <input id="base-url" name="baseUrl" type="url" placeholder="https://provider.example/v1" defaultValue={savedHttp?.baseUrl ?? ''} />
              </div>
              <div className="field-stack">
                <label htmlFor="network-scope">{copy.networkScope}</label>
                <select id="network-scope" name="networkScope" defaultValue={savedHttp?.networkScope ?? 'public'}>
                  <option value="public">Public HTTPS</option>
                  <option value="private">Private / Tailscale</option>
                  <option value="loopback">Worker loopback</option>
                </select>
              </div>
              <div className="field-stack field-stack--wide">
                <label htmlFor="api-key">{copy.apiKey}</label>
                <input id="api-key" name="apiKey" type="password" autoComplete="new-password" />
              </div>
            </>
          ) : null}
          {visibility.roleSelection ? (
            <fieldset className="field-stack field-stack--wide role-assignments">
              <legend>{copy.roleAssignments}</legend>
              {AiRoleSchema.options.map((role) => (
                <label className="checkbox-field" key={role}>
                  <input name="roles" type="checkbox" value={role} defaultChecked={(savedHttp?.roles ?? ['niche_normalization']).includes(role)} />
                  <span>{role}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
        </div>

        <p className="privacy-note">{copy.privacyNote}</p>
        <button className="button button--primary" type="submit" disabled={status.kind === 'saving'}>
          {status.kind === 'saving' ? copy.uploadingFiles : copy.saveProvider}
        </button>
        {errorMessage ? <p className="notice notice--error" role="alert">{errorMessage}</p> : null}
        {status.kind === 'saved' ? <p role="status">{copy.providerSaved}</p> : null}
      </form>

      {providers.map((provider) => provider.product === 'openai_compatible_api' ? (
        <section className="provider-result" aria-labelledby={`provider-${provider.id}`} key={provider.id}>
          <h2 id={`provider-${provider.id}`}>{provider.productLabel} · {provider.name}</h2>
          {provider.secretLast4 ? <p className="import-id"><span>{copy.secretStored}</span> <code>••••{provider.secretLast4}</code></p> : null}
          <p className="privacy-note">{copy.httpTestCostWarning}</p>
          <button className="button button--secondary" type="button" onClick={() => void testConnection(provider)} disabled={status.kind === 'testing'}>
            {status.kind === 'testing' ? copy.uploadingFiles : copy.testConnection}
          </button>
          {status.kind === 'tested' && status.providerId === provider.id ? (
            <p className={status.available ? 'notice notice--success' : 'notice notice--error'} role="status">
              {status.available ? copy.connectionReady : copy.connectionUnavailable}
              {status.available && status.models.length > 0 ? (
                <>{' '}<span>{status.models.join(', ')}</span></>
              ) : null}
            </p>
          ) : null}
        </section>
      ) : (
        <section className="provider-result" aria-labelledby={`provider-${provider.id}`} key={provider.id}>
          <h2 id={`provider-${provider.id}`}>{provider.productLabel}</h2>
          <dl>
            <div><dt>{copy.billingType}</dt><dd>{copy.subscriptionLabel}</dd></div>
            <div><dt>{copy.subscriptionStatus}</dt><dd>{subscriptionStatusLabel(provider, copy)}</dd></div>
            <div><dt>{copy.subscriptionModel}</dt><dd>{provider.modelLabel}</dd></div>
            <div><dt>{copy.subscriptionRole}</dt><dd><code>{provider.role}</code></dd></div>
            <div><dt>{copy.providerPriority}</dt><dd>{provider.priority}</dd></div>
            <div><dt>{copy.lastProbe}</dt><dd>{provider.lastCheckedAt ?? '—'}</dd></div>
          </dl>
          <p className="privacy-note">{copy.operatorAuthorizationGuidance}</p>
          <div className="button-row">
            <button className="button button--secondary" type="button" onClick={() => void testConnection(provider)} disabled={status.kind === 'testing'}>
              {status.kind === 'testing' ? copy.uploadingFiles : copy.testConnection}
            </button>
            <button className="button button--secondary" type="button" onClick={() => void disableSubscription(provider)}>
              {copy.disableProvider}
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
