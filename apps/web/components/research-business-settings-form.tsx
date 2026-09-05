'use client';

import { ResearchBusinessSettingsSchema, type ResearchBusinessSettings } from '@ara/shared';
import ky from 'ky';
import { useEffect, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { adminCsrfHeaders } from '../lib/admin-csrf';
import { BusinessSettingsExplanation } from './candidate-business-presentation';

const SettingsResponseSchema = z.object({ settings: ResearchBusinessSettingsSchema });

type SettingsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly settings: ResearchBusinessSettings }
  | { readonly kind: 'saving'; readonly settings: ResearchBusinessSettings }
  | { readonly kind: 'unavailable' };

function valuesFrom(settings: ResearchBusinessSettings): Record<keyof ResearchBusinessSettings, string> {
  return {
    launchBudgetUsd: String(settings.launchBudgetUsd), minimumPreAdMarginPct: String(settings.minimumPreAdMarginPct),
    minimumPostAdMarginPct: String(settings.minimumPostAdMarginPct), minimumRoiPct: String(settings.minimumRoiPct)
  };
}

export function ResearchBusinessSettingsForm() {
  const [state, setState] = useState<SettingsState>({ kind: 'loading' });
  const [values, setValues] = useState<Record<keyof ResearchBusinessSettings, string> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const setValue = (field: keyof ResearchBusinessSettings, value: string) => {
    setValues((current) => current === null ? current : { ...current, [field]: value });
  };

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const { settings } = SettingsResponseSchema.parse(await ky.get('/api/research-settings', { credentials: 'same-origin', signal: controller.signal }).json<unknown>());
        if (controller.signal.aborted) return;
        setValues(valuesFrom(settings));
        setState({ kind: 'ready', settings });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof Error) {
          setState({ kind: 'unavailable' });
          return;
        }
        throw error;
      }
    })();
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (state.kind !== 'ready' || values === null) return;
    const parsed = ResearchBusinessSettingsSchema.safeParse({
      launchBudgetUsd: Number(values.launchBudgetUsd), minimumPreAdMarginPct: Number(values.minimumPreAdMarginPct),
      minimumPostAdMarginPct: Number(values.minimumPostAdMarginPct), minimumRoiPct: Number(values.minimumRoiPct)
    });
    if (!parsed.success) {
      setNotice('네 기준은 0 이상인 유한 숫자로 입력하세요. 출시 예산은 0보다 커야 합니다.');
      return;
    }
    setNotice(null);
    setState({ kind: 'saving', settings: state.settings });
    try {
      const { settings } = SettingsResponseSchema.parse(await ky.post('/api/research-settings', {
        json: parsed.data, headers: adminCsrfHeaders(), credentials: 'same-origin'
      }).json<unknown>());
      setValues(valuesFrom(settings));
      setState({ kind: 'ready', settings });
      setNotice('출시 예산·수익성 기준을 저장했습니다.');
    } catch (error) {
      if (error instanceof Error) {
        setState({ kind: 'ready', settings: state.settings });
        setNotice('출시 예산·수익성 기준을 저장하지 못했습니다. 기본값으로 대체하지 않습니다.');
        return;
      }
      throw error;
    }
  }

  if (state.kind === 'loading') return <p className="notice" role="status">출시 예산·수익성 기준을 불러오는 중입니다.</p>;
  if (state.kind === 'unavailable') return <p className="notice notice--error" role="alert">출시 예산·수익성 기준을 불러올 수 없습니다. 기본값으로 대체하지 않습니다.</p>;
  const settings = state.settings;
  return <form className="business-settings-form" onSubmit={submit}>
    <div className="form-grid">
      <div className="field-stack"><label htmlFor="launchBudgetUsd">출시 예산 (USD)</label><input id="launchBudgetUsd" type="number" min="0.01" step="0.01" value={values?.launchBudgetUsd ?? ''} onChange={(event) => setValue('launchBudgetUsd', event.currentTarget.value)} /></div>
      <div className="field-stack"><label htmlFor="minimumPreAdMarginPct">광고 전 최소 마진 (%)</label><input id="minimumPreAdMarginPct" type="number" min="0" max="100" step="0.1" value={values?.minimumPreAdMarginPct ?? ''} onChange={(event) => setValue('minimumPreAdMarginPct', event.currentTarget.value)} /></div>
      <div className="field-stack"><label htmlFor="minimumPostAdMarginPct">광고 후 최소 마진 (%)</label><input id="minimumPostAdMarginPct" type="number" min="0" max="100" step="0.1" value={values?.minimumPostAdMarginPct ?? ''} onChange={(event) => setValue('minimumPostAdMarginPct', event.currentTarget.value)} /></div>
      <div className="field-stack"><label htmlFor="minimumRoiPct">최소 ROI (%)</label><input id="minimumRoiPct" type="number" min="0" step="0.1" value={values?.minimumRoiPct ?? ''} onChange={(event) => setValue('minimumRoiPct', event.currentTarget.value)} /></div>
    </div>
    <BusinessSettingsExplanation settings={settings} />
    <p className="field-help">광고 전 마진은 판매가를 분모로 단위 광고비를 더한 단위 기여이익, 광고 후 마진은 판매가를 분모로 한 단위 기여이익입니다. ROI는 광고 후 단위 기여이익 ÷ 도착 단가입니다.</p>
    <button className="button button--primary" type="submit" disabled={state.kind === 'saving'}>{state.kind === 'saving' ? '상업 기준 저장 중…' : '상업 기준 저장'}</button>
    {notice ? <p className={notice === '출시 예산·수익성 기준을 저장했습니다.' ? 'notice notice--success' : 'notice'} role="status">{notice}</p> : null}
  </form>;
}
