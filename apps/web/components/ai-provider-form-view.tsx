import { AiRoleSchema, getCopy, type Locale } from '@ara/shared';
import {
  AI_PROVIDER_PRODUCT_OPTIONS,
  aiProviderProductFields,
  type AiProviderProduct
} from '../../../packages/shared/src/i18n';
import type { FormEvent } from 'react';
import { providerFormKey } from './ai-provider-form-key';
import type {
  CopyDictionary,
  HttpProvider,
  ProviderTestResult,
  SavedProvider,
  SubscriptionProvider
} from './ai-provider-form-model';
import {
  billingShort,
  displayIdentity,
  rolePresentation,
  roleSummary,
  subscriptionStatusLabel,
  subscriptionStatusTone
} from './ai-provider-form-presentation';

type TestResults = Readonly<Record<string, ProviderTestResult>>;

function testResultMessage(locale: Locale, copy: CopyDictionary, result: ProviderTestResult): string {
  if (result.kind === 'timed_out') return locale === 'ko'
    ? '이 세션의 테스트 결과 대기 시간이 지났습니다. 연결 실패가 확인된 것은 아닙니다.'
    : 'This session timed out waiting for a test result. It does not confirm a connection failure.';
  if (result.kind === 'inconclusive') return locale === 'ko'
    ? '이 세션에서 연결 결과를 확인하지 못했습니다. 작업 완료 여부와 연결 상태는 확인되지 않았습니다.'
    : 'This session could not confirm a connection result. Neither job completion nor connection status is confirmed.';
  if (result.kind === 'failed') return locale === 'ko'
    ? '연결 테스트 작업이 실패했습니다. Provider 연결 실패로 단정할 수 없습니다.'
    : 'The connection test job failed. This does not by itself confirm a provider connection failure.';
  if (result.available) return copy.connectionReady;
  if (result.errorCategory === 'provider_response_invalid') return copy.connectionResponseInvalid;
  if (result.errorCategory === 'provider_request_rejected') return copy.connectionRequestRejected;
  return copy.connectionUnavailable;
}

function ProviderStatus({ provider, copy }: { readonly provider: SavedProvider; readonly copy: CopyDictionary }) {
  if (provider.product === 'openai_compatible_api') {
    return provider.enabled
      ? <span className="status status--tone-accent">{copy.providerActive}</span>
      : <span className="status status--tone-neutral">{copy.providerDisabled}</span>;
  }
  return <span className={`status status--tone-${subscriptionStatusTone(provider)}`}>{subscriptionStatusLabel(provider, copy)}</span>;
}

export function AiProviderFormView({
  locale,
  providers,
  saved,
  product,
  isSaving,
  testingProviderId,
  testResults,
  saveError,
  savedMessage,
  onNew,
  onSelect,
  onProductChange,
  onSubmit,
  onTest,
  onDisable
}: {
  readonly locale: Locale;
  readonly providers: readonly SavedProvider[];
  readonly saved: SavedProvider | null;
  readonly product: AiProviderProduct;
  readonly isSaving: boolean;
  readonly testingProviderId: string | null;
  readonly testResults: TestResults;
  readonly saveError: string | null;
  readonly savedMessage: boolean;
  readonly onNew: () => void;
  readonly onSelect: (provider: SavedProvider) => void;
  readonly onProductChange: (product: string) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  readonly onTest: (provider: SavedProvider) => Promise<void>;
  readonly onDisable: (provider: SubscriptionProvider) => Promise<void>;
}) {
  const copy = getCopy(locale);
  const listedProviders = saved ? [saved, ...providers.filter((provider) => provider.id !== saved.id)] : providers;
  const savedHttp: HttpProvider | null = saved?.product === 'openai_compatible_api' ? saved : null;
  const visibility = aiProviderProductFields(product);
  const selectedTestResult = saved ? testResults[saved.id] : undefined;
  const enabledCount = listedProviders.filter((provider) => provider.enabled).length;
  const attentionCount = listedProviders.filter((provider) => provider.product !== 'openai_compatible_api' && provider.setupStatus !== 'ready' && provider.setupStatus !== 'disabled').length;
  const activeRoles = [...new Set(listedProviders.flatMap((provider) => provider.product === 'openai_compatible_api' ? provider.roles : [provider.role]))];
  const rolesSummary = activeRoles.map((role) => {
    const parsed = AiRoleSchema.safeParse(role);
    return parsed.success ? rolePresentation(locale, parsed.data)[0] : role;
  }).join(', ');
  const resultIsSuccess = selectedTestResult?.kind === 'completed' && selectedTestResult.available;

  return (
    <div className="fleet-console">
      <section className="fleet-overview" aria-labelledby="fleet-overview-title">
        <div className="section-heading"><h2 id="fleet-overview-title">{copy.fleetTitle}</h2></div>
        <p className="fleet-overview__line"><strong>{enabledCount}</strong> {copy.fleetEnabled}<span aria-hidden="true"> · </span><strong>{attentionCount}</strong> {copy.fleetAttention}<span aria-hidden="true"> · </span><strong>{listedProviders.length}</strong> {copy.fleetTotal}{rolesSummary ? <><span aria-hidden="true"> · </span>{copy.fleetRoles}: {rolesSummary}</> : null}</p>
        <button className="button button--primary fleet-overview__add" type="button" onClick={onNew}>{copy.addProvider}</button>
      </section>

      <div className="fleet-layout">
        <aside className="provider-directory" aria-labelledby="saved-providers-title">
          <div className="section-heading"><div className="section-heading__title"><h2 id="saved-providers-title">{copy.savedProviders}</h2><span className="section-count">{listedProviders.length}</span></div></div>
          {listedProviders.length === 0 ? <p>{copy.noProviders}</p> : <ul className="provider-directory__list">
            {listedProviders.map((provider) => {
              const identity = displayIdentity(provider);
              const roleText = roleSummary(locale, provider);
              return <li key={provider.id}><button aria-label={`${identity.label} ${copy.editProvider}`} aria-pressed={saved?.id === provider.id} className="provider-directory__item" type="button" onClick={() => onSelect(provider)}>
                <span className="provider-directory__identity"><strong>{identity.label}</strong>{identity.fallback ? <code className="provider-directory__id">{provider.name}</code> : null}</span>
                <span className="provider-directory__meta"><ProviderStatus provider={provider} copy={copy} /><span>{billingShort(provider, copy)}</span>{roleText ? <span>{roleText}</span> : null}</span>
              </button></li>;
            })}
          </ul>}
        </aside>

        <section className="provider-workspace" aria-labelledby="workspace-title">
          <header className="provider-workspace__heading">
            <p>{saved ? saved.productLabel : copy.newOpenAiProvider}</p>
            <h2 id="workspace-title">{saved ? `${displayIdentity(saved).label} ${copy.editProvider}` : copy.newOpenAiProvider}</h2>
            {saved ? <ProviderStatus provider={saved} copy={copy} /> : null}
            {savedHttp?.secretLast4 ? <p className="workspace-key"><span>{copy.secretStored}</span> <code>••••{savedHttp.secretLast4}</code></p> : null}
          </header>

          <form className="ai-provider-form" onSubmit={(event) => void onSubmit(event)} key={providerFormKey(saved)}>
            <section className="form-group"><h3>{copy.providerGroupIdentity}</h3><div className="form-grid">
              <div className="field-stack"><label htmlFor="provider-product">{copy.providerProduct}</label><select id="provider-product" name="product" value={product} onChange={(event) => onProductChange(event.target.value)}>{AI_PROVIDER_PRODUCT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
              {visibility.httpCredentials ? <><div className="field-stack"><label htmlFor="provider-name">{copy.providerName}</label><input id="provider-name" name="name" required autoComplete="off" defaultValue={savedHttp?.name ?? ''} /></div><div className="field-stack"><label htmlFor="billing-type">{copy.billingType}</label><select id="billing-type" name="billingType" defaultValue={savedHttp?.billingType ?? 'subscription'}><option value="free">Free</option><option value="subscription">Subscription</option><option value="payg">Pay-as-you-go</option></select></div><label className="checkbox-field"><input name="enabled" type="checkbox" defaultChecked={savedHttp?.enabled ?? true} /><span>{copy.providerEnabled}</span></label></> : null}
            </div></section>
            {visibility.modelConfiguration || visibility.roleSelection ? <section className="form-group"><h3>{copy.providerGroupCapability}</h3><div className="form-grid">
              {visibility.modelConfiguration ? <><div className="field-stack"><label htmlFor="model-id">{copy.modelId}</label><input id="model-id" name="modelId" placeholder="model-id" defaultValue={savedHttp?.modelId ?? ''} /></div>{(savedHttp?.models ?? []).map((model) => <div key={model.id} className="field-stack field-stack--wide"><label className="checkbox-field"><input name={`model-enabled-${model.id}`} type="checkbox" defaultChecked={model.enabled} /><span>{copy.modelEnabled}: {model.displayName} ({model.origin})</span></label><label htmlFor={`model-priority-${model.id}`}>{copy.modelPriority}</label><input id={`model-priority-${model.id}`} name={`model-priority-${model.id}`} type="number" min={0} defaultValue={model.priority} /></div>)}{(!savedHttp || savedHttp.models.length === 0) ? <><label className="checkbox-field"><input name="modelEnabled" type="checkbox" defaultChecked /><span>{copy.modelEnabled}</span></label><div className="field-stack"><label htmlFor="model-priority">{copy.modelPriority}</label><input id="model-priority" name="modelPriority" type="number" min={0} defaultValue={100} /></div></> : null}</> : null}
              {visibility.roleSelection ? <fieldset className="field-stack field-stack--wide role-assignments"><legend>{copy.roleAssignments}</legend>{AiRoleSchema.options.map((role) => { const [label, purpose] = rolePresentation(locale, role); return <label className="checkbox-field" key={role}><input name="roles" type="checkbox" value={role} defaultChecked={(savedHttp?.roles ?? ['niche_normalization']).includes(role)} /><span><strong>{label}</strong>{' '}{purpose}</span></label>; })}</fieldset> : null}
            </div></section> : null}
            <section className="form-group"><h3>{copy.providerGroupRouting}</h3><div className="form-grid"><div className="field-stack"><label htmlFor="provider-priority">{copy.providerPriority}</label><input id="provider-priority" name="priority" type="number" min={0} defaultValue={saved?.priority ?? 100} /><p className="privacy-note">{locale === 'ko' ? '작은 숫자가 먼저 선택됩니다. Balanced는 역할 우선순위 → 결제 방식 → 모델 품질, Saver는 결제 방식 → 역할 우선순위 → 모델 품질, Highest Quality는 모델 품질 → 역할 우선순위 → 결제 방식 순입니다. 같은 값이면 provider와 model ID 순으로 고정합니다.' : 'Lower numbers are selected first. Balanced orders role priority, billing, then model quality; Saver orders billing, role priority, then model quality; Highest Quality orders model quality, role priority, then billing. Exact ties use provider and model ID.'}</p></div></div></section>
            {visibility.httpCredentials ? <section className="form-group"><h3>{copy.providerGroupConnection}</h3><div className="form-grid"><div className="field-stack field-stack--wide"><label htmlFor="base-url">{copy.baseUrl}</label><input id="base-url" name="baseUrl" type="url" placeholder="https://provider.example/v1" defaultValue={savedHttp?.baseUrl ?? ''} /></div><div className="field-stack"><label htmlFor="network-scope">{copy.networkScope}</label><select id="network-scope" name="networkScope" defaultValue={savedHttp?.networkScope ?? 'public'}><option value="public">Public HTTPS</option><option value="private">Private / Tailscale</option><option value="loopback">Worker loopback</option></select></div><div className="field-stack field-stack--wide"><label htmlFor="api-key">{copy.apiKey}</label><input id="api-key" name="apiKey" type="password" autoComplete="new-password" /></div>{savedHttp?.baseUrl && new URL(savedHttp.baseUrl).hostname === 'openrouter.ai' ? <label className="checkbox-field field-stack--wide"><input name="openRouterProvider" type="checkbox" value="z-ai" defaultChecked={savedHttp.openRouterProvider === 'z-ai'} /><span>{copy.openRouterZaiOnly}</span></label> : null}</div></section> : null}
            <p className="privacy-note">{copy.privacyNote}</p><div className="wrap-row"><button className="button button--primary" type="submit" disabled={isSaving || testingProviderId !== null}>{isSaving ? copy.savingProvider : copy.saveProvider}</button>{saveError ? <p className="notice notice--error" role="alert">{saveError}</p> : null}{savedMessage ? <p role="status">{copy.providerSaved}</p> : null}</div>
          </form>

          <section className="workspace-test" aria-labelledby="workspace-test-title"><div className="section-heading"><h3 id="workspace-test-title">{copy.testSectionTitle}</h3></div>
            {!saved ? <p className="workspace-test__hint">{copy.workspaceNewHint}</p> : <div className="workspace-test__body">
              {saved.product === 'openai_compatible_api' ? null : <><dl className="workspace-facts"><div><dt>{copy.billingType}</dt><dd>{copy.subscriptionLabel}</dd></div><div><dt>{copy.subscriptionModel}</dt><dd>{saved.modelLabel}</dd></div><div><dt>{copy.subscriptionRole}</dt><dd>{rolePresentation(locale, saved.role)[0]} · {rolePresentation(locale, saved.role)[1]}</dd></div><div><dt>{copy.providerPriority}</dt><dd>{saved.priority}</dd></div><div><dt>{copy.lastProbe}</dt><dd>{saved.lastCheckedAt ?? '-'}</dd></div></dl><p className="privacy-note">{copy.operatorAuthorizationGuidance}</p></>}
              <div className="wrap-row"><button className="button button--secondary" type="button" onClick={() => void onTest(saved)} disabled={isSaving || testingProviderId !== null}>{testingProviderId === saved.id ? copy.testingConnection : copy.testConnection}</button>{saved.product !== 'openai_compatible_api' ? <button className="button button--secondary" type="button" onClick={() => void onDisable(saved)} disabled={isSaving || testingProviderId !== null}>{copy.disableProvider}</button> : null}</div>
              {selectedTestResult ? <p className={resultIsSuccess ? 'notice notice--success' : selectedTestResult.kind === 'failed' ? 'notice notice--error' : 'notice'} role="status">{testResultMessage(locale, copy, selectedTestResult)}{selectedTestResult.kind === 'completed' && selectedTestResult.available && selectedTestResult.models.length > 0 ? <> <span>{selectedTestResult.models.join(', ')}</span></> : null}</p> : <p className="workspace-test__hint">{locale === 'ko' ? '운영 활성 상태와 이번 세션의 연결 테스트 결과는 별도로 표시됩니다.' : 'Operational status and this session’s connection-test result are shown separately.'}</p>}
            </div>}
          </section>
        </section>
      </div>
    </div>
  );
}
