'use client';

import {
  AiRoleSchema,
  BillingTypeSchema,
  getCopy,
  ProviderKindSchema,
  type Locale
} from '@ara/shared';
import ky from 'ky';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';

const ProviderModelSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  billingType: BillingTypeSchema,
  capabilities: z.array(z.string()),
  qualityRank: z.number()
});

const ProviderResponseSchema = z.object({
  provider: z.object({
    id: z.string(),
    name: z.string(),
    kind: ProviderKindSchema,
    billingType: BillingTypeSchema,
    enabled: z.boolean(),
    secretLast4: z.string().nullable(),
    models: z.array(ProviderModelSchema),
    roles: z.array(z.string()).default([])
  })
});

const ConnectionResponseSchema = z.object({
  available: z.boolean(),
  providerId: z.string().nullable(),
  models: z.array(z.string()),
  reason: z.string().nullable()
});

type FormStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'testing' }
  | { readonly kind: 'tested'; readonly available: boolean; readonly models: readonly string[] };

type SavedProvider = z.infer<typeof ProviderResponseSchema>['provider'];

function parseFixedArgs(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string' || value.trim() === '') {
    return [];
  }
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error('Fixed arguments must be a JSON array of strings.');
  }
  return parsed;
}

export function AiProviderForm({ locale }: { locale: Locale }) {
  const copy = getCopy(locale);
  const [saved, setSaved] = useState<SavedProvider | null>(null);
  const [status, setStatus] = useState<FormStatus>({ kind: 'idle' });

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStatus({ kind: 'saving' });
    const form = event.currentTarget;
    let fixedArgs: string[];
    try {
      fixedArgs = parseFixedArgs(new FormData(form).get('fixedArgs'));
    } catch (error) {
      if (error instanceof Error) {
        setStatus({ kind: 'error', message: error.message });
        return;
      }
      throw error;
    }
    const formData = new FormData(form);

    const body = {
      name: formData.get('name') ?? '',
      kind: formData.get('kind') ?? 'openai_http',
      billingType: formData.get('billingType') ?? 'subscription',
      baseUrl: formData.get('baseUrl') ?? '',
      apiKey: formData.get('apiKey') ?? '',
      modelId: formData.get('modelId') ?? '',
      executable: formData.get('executable') ?? '',
      fixedArgs,
      roles: formData
        .getAll('roles')
        .filter((value): value is string => typeof value === 'string'),
      enabled: formData.get('enabled') === 'on',
      promptMode: 'stdin',
      outputMode: 'json',
      environmentAllowlist: []
    };

    try {
      const result = ProviderResponseSchema.parse(
        await ky.post('/api/ai-providers', { json: body }).json<unknown>()
      );
      setSaved(result.provider);
      setStatus({ kind: 'saved' });
      form.reset();
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
      const result = ConnectionResponseSchema.parse(
        await ky
          .post('/api/ai-providers/test', { json: { providerId: saved.id } })
          .json<unknown>()
      );
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

  return (
    <form className="ai-provider-form" onSubmit={submit}>
      <div className="form-grid">
        <div className="field-stack">
          <label htmlFor="provider-name">{copy.providerName}</label>
          <input id="provider-name" name="name" required autoComplete="off" />
        </div>
        <div className="field-stack">
          <label htmlFor="provider-kind">{copy.providerKind}</label>
          <select id="provider-kind" name="kind" defaultValue="openai_http">
            <option value="openai_http">OpenAI-compatible HTTP</option>
            <option value="command">Command provider</option>
          </select>
        </div>
        <div className="field-stack">
          <label htmlFor="billing-type">{copy.billingType}</label>
          <select id="billing-type" name="billingType" defaultValue="subscription">
            <option value="free">Free</option>
            <option value="subscription">Subscription</option>
            <option value="payg">Pay-as-you-go</option>
          </select>
        </div>
        <label className="checkbox-field">
          <input name="enabled" type="checkbox" defaultChecked />
          <span>{copy.providerEnabled}</span>
        </label>
        <div className="field-stack">
          <label htmlFor="model-id">{copy.modelId}</label>
          <input id="model-id" name="modelId" placeholder="model-id" />
        </div>
        <div className="field-stack field-stack--wide">
          <label htmlFor="base-url">{copy.baseUrl}</label>
          <input id="base-url" name="baseUrl" type="url" placeholder="http://127.0.0.1:4000/v1" />
        </div>
        <div className="field-stack field-stack--wide">
          <label htmlFor="api-key">{copy.apiKey}</label>
          <input id="api-key" name="apiKey" type="password" autoComplete="new-password" />
        </div>
        <div className="field-stack field-stack--wide">
          <label htmlFor="executable">{copy.executable}</label>
          <input id="executable" name="executable" placeholder="kiro-cli" />
        </div>
        <div className="field-stack field-stack--wide">
          <label htmlFor="fixed-args">{copy.fixedArgs}</label>
          <input id="fixed-args" name="fixedArgs" defaultValue="[]" spellCheck="false" />
        </div>
        <fieldset className="field-stack field-stack--wide role-assignments">
          <legend>{copy.roleAssignments}</legend>
          {AiRoleSchema.options.map((role) => (
            <label className="checkbox-field" key={role}>
              <input
                name="roles"
                type="checkbox"
                value={role}
                defaultChecked={role === 'niche_normalization'}
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
          <p role="status">{copy.providerSaved}</p>
          {saved.secretLast4 ? (
            <p className="import-id">
              <span>{copy.secretStored}</span> <code>••••{saved.secretLast4}</code>
            </p>
          ) : null}
          <button className="button button--secondary" type="button" onClick={testConnection} disabled={status.kind === 'testing'}>
            {status.kind === 'testing' ? copy.uploadingFiles : copy.testConnection}
          </button>
          {status.kind === 'tested' ? (
            <p className={status.available ? 'notice notice--success' : 'notice notice--error'} role="status">
              {status.available ? copy.connectionReady : copy.connectionUnavailable}
              {status.models.length > 0 ? ` · ${status.models.join(', ')}` : ''}
            </p>
          ) : null}
        </section>
      ) : null}
    </form>
  );
}
