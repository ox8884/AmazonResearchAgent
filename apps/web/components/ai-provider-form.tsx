'use client';

import { getCopy, type Locale } from '@ara/shared';
import {
  AI_PROVIDER_PRODUCT_OPTIONS,
  type AiProviderProduct
} from '../../../packages/shared/src/i18n';
import ky from 'ky';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { adminCsrfHeaders } from '../lib/admin-csrf';
import {
  clearProviderTestResult,
  ConnectionJobResponseSchema,
  ProviderListSchema,
  ProviderResponseSchema,
  type HttpProvider,
  type ProviderTestResult,
  type SavedProvider,
  type SubscriptionProvider,
  waitForProviderTest
} from './ai-provider-form-model';
import { AiProviderFormView } from './ai-provider-form-view';

export { AI_PROVIDER_PRODUCT_OPTIONS as PRODUCT_PROVIDER_OPTIONS, aiProviderProductFields as productFieldVisibility } from '../../../packages/shared/src/i18n';

type FormStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'error'; readonly message: string };

export function AiProviderForm({ locale }: { readonly locale: Locale }) {
  const copy = getCopy(locale);
  const [providers, setProviders] = useState<readonly SavedProvider[]>([]);
  const [saved, setSaved] = useState<SavedProvider | null>(null);
  const [product, setProduct] = useState<AiProviderProduct>('codex_subscription');
  const [status, setStatus] = useState<FormStatus>({ kind: 'idle' });
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Readonly<Record<string, ProviderTestResult>>>({});
  const selectionEstablished = useRef(false);
  const latestListRequest = useRef(0);

  async function loadProviders(): Promise<readonly SavedProvider[]> {
    const requestId = ++latestListRequest.current;
    const result = ProviderListSchema.parse(
      await ky.get('/api/ai-providers', { credentials: 'same-origin' }).json<unknown>()
    );
    if (requestId === latestListRequest.current) setProviders(result.providers);
    return result.providers;
  }

  useEffect(() => {
    void loadProviders()
      .then((listed) => {
        const first = listed[0];
        if (first && !selectionEstablished.current) selectProvider(first);
      })
      .catch((error: unknown) => {
        if (selectionEstablished.current) return;
        if (error instanceof Error) {
          setStatus({ kind: 'error', message: copy.connectionUnavailable });
          return;
        }
        throw error;
      });
  }, [copy.connectionUnavailable]);

  function selectProvider(provider: SavedProvider): void {
    if (status.kind === 'saving') return;
    selectionEstablished.current = true;
    setSaved(provider);
    setProduct(provider.product);
    setStatus({ kind: 'idle' });
  }

  function startNewProvider(): void {
    if (status.kind === 'saving') return;
    selectionEstablished.current = true;
    setSaved(null);
    setProduct('openai_compatible_api');
    setStatus({ kind: 'idle' });
  }

  function selectProduct(nextProduct: string): void {
    if (status.kind === 'saving') return;
    if (!isProviderProduct(nextProduct)) return;
    selectionEstablished.current = true;
    setProduct(nextProduct);
    setSaved(null);
    setStatus({ kind: 'idle' });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (testingProviderId !== null || status.kind === 'saving') return;
    selectionEstablished.current = true;
    setStatus({ kind: 'saving' });
    const formData = new FormData(event.currentTarget);
    const submittedProduct = formData.get('product');
    if (typeof submittedProduct !== 'string' || !isProviderProduct(submittedProduct)) {
      setStatus({ kind: 'error', message: copy.connectionUnavailable });
      return;
    }
    const selectedProduct = submittedProduct;
    const savedHttp = saved?.product === 'openai_compatible_api' ? saved : null;
    const body: Record<string, unknown> = selectedProduct === 'openai_compatible_api'
      ? httpSubmission(formData, savedHttp)
      : { product: selectedProduct, priority: Number(formData.get('priority') ?? 100) };
    try {
      const result = ProviderResponseSchema.parse(await ky.post('/api/ai-providers', {
        json: body,
        headers: adminCsrfHeaders(),
        credentials: 'same-origin'
      }).json<unknown>());
      setSaved(result.provider);
      setProduct(result.provider.product);
      setTestResults((current) => clearProviderTestResult(current, result.provider.id));
      await loadProviders();
      setStatus({ kind: 'saved' });
    } catch (error: unknown) {
      if (error instanceof Error) {
        setStatus({ kind: 'error', message: copy.connectionUnavailable });
        return;
      }
      throw error;
    }
  }

  async function testConnection(provider: SavedProvider): Promise<void> {
    if (testingProviderId !== null || status.kind === 'saving') return;
    setTestingProviderId(provider.id);
    let resultRecorded = false;
    try {
      const queued = ConnectionJobResponseSchema.parse(await ky.post('/api/ai-providers/test', {
        json: { providerId: provider.id },
        headers: adminCsrfHeaders(),
        credentials: 'same-origin'
      }).json<unknown>());
      const result = await waitForProviderTest(queued.jobId);
      setTestResults((current) => ({ ...current, [provider.id]: result }));
      resultRecorded = true;
      const listed = await loadProviders();
      const refreshed = listed.find((item) => item.id === provider.id);
      if (refreshed) {
        setSaved((current) => current?.id === provider.id ? refreshed : current);
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        if (!resultRecorded) {
          setTestResults((current) => ({ ...current, [provider.id]: { kind: 'inconclusive' } }));
        }
        return;
      }
      throw error;
    } finally {
      setTestingProviderId(null);
    }
  }

  async function disableSubscription(provider: SubscriptionProvider): Promise<void> {
    if (testingProviderId !== null || status.kind === 'saving') return;
    setStatus({ kind: 'saving' });
    try {
      await ky.post('/api/ai-providers', {
        json: { action: 'disable', providerId: provider.id },
        headers: adminCsrfHeaders(),
        credentials: 'same-origin'
      });
      const listed = await loadProviders();
      const refreshed = listed.find((item) => item.id === provider.id);
      if (refreshed) selectProvider(refreshed);
      setStatus({ kind: 'idle' });
    } catch (error: unknown) {
      if (error instanceof Error) {
        setStatus({ kind: 'error', message: copy.connectionUnavailable });
        return;
      }
      throw error;
    }
  }

  return <AiProviderFormView
    locale={locale}
    providers={providers}
    saved={saved}
    product={product}
    isSaving={status.kind === 'saving'}
    testingProviderId={testingProviderId}
    testResults={testResults}
    saveError={status.kind === 'error' ? status.message : null}
    savedMessage={status.kind === 'saved'}
    onNew={startNewProvider}
    onSelect={selectProvider}
    onProductChange={selectProduct}
    onSubmit={submit}
    onTest={testConnection}
    onDisable={disableSubscription}
  />;
}

function isProviderProduct(value: string): value is AiProviderProduct {
  return AI_PROVIDER_PRODUCT_OPTIONS.some((option) => option.value === value);
}

function httpSubmission(formData: FormData, savedHttp: HttpProvider | null): Record<string, unknown> {
  const submittedModelId = String(formData.get('modelId') ?? '').trim();
  const isNewManual = submittedModelId.length > 0 && submittedModelId !== (savedHttp?.modelId ?? '');
  return {
    product: 'openai_compatible_api',
    id: savedHttp?.id,
    name: formData.get('name') ?? '',
    billingType: formData.get('billingType') ?? 'subscription',
    baseUrl: formData.get('baseUrl') ?? '',
    networkScope: formData.get('networkScope') ?? 'public',
    apiKey: formData.get('apiKey') ?? '',
    modelId: submittedModelId,
    ...(formData.get('openRouterProvider') === 'z-ai' ? { openRouterProvider: 'z-ai' } : {}),
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
}
