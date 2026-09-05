'use client';

import { ResearchBusinessEvidenceSchema, ResearchBusinessSettingsSchema, type ResearchBusinessEvidence } from '@ara/shared';
import ky from 'ky';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { adminCsrfHeaders } from '../lib/admin-csrf';
import { CandidateBusinessInputs } from './candidate-business-fields';
import { businessEvidenceFrom, initialBusinessFormValues, type BusinessFormValues } from './candidate-business-values';
import { BusinessAssessment, type CandidateBusinessResult } from './candidate-business-presentation';

const CandidateBusinessResultSchema = z.object({
  evidence: ResearchBusinessEvidenceSchema.nullable(),
  assessment: z.object({
    stage: z.enum(['basic_check', 'market_validation', 'quote_ready', 'awaiting_quote', 'awaiting_sample', 'purchase_review', 'hold', 'reject']),
    gaps: z.array(z.string()), settings: ResearchBusinessSettingsSchema, estimatedLaunchCashUsd: z.number().nullable(),
    estimatedUnitContributionUsd: z.number().nullable(), estimatedMarginPct: z.number().nullable(), purchaseApproved: z.literal(false)
  })
});

type FormState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly result: CandidateBusinessResult }
  | { readonly kind: 'saving'; readonly result: CandidateBusinessResult }
  | { readonly kind: 'unavailable' };

export function CandidateBusinessForm({ candidateId }: { readonly candidateId: string }) {
  const [formState, setFormState] = useState<FormState>({ kind: 'loading' });
  const [values, setValues] = useState<BusinessFormValues>(() => initialBusinessFormValues(null));
  const [savedEvidence, setSavedEvidence] = useState<ResearchBusinessEvidence | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const latestAssessmentRequest = useRef(0);

  const reloadAssessment = useCallback(async () => {
    const request = ++latestAssessmentRequest.current;
    setNotice(null);
    setFormState({ kind: 'loading' });
    try {
      const result = CandidateBusinessResultSchema.parse(await ky.get(`/api/candidates/${candidateId}/business`, { credentials: 'same-origin', cache: 'no-store' }).json<unknown>());
      if (request !== latestAssessmentRequest.current) return;
      setValues(initialBusinessFormValues(result.evidence));
      setSavedEvidence(result.evidence);
      setFormState({ kind: 'ready', result });
    } catch (error) {
      if (request !== latestAssessmentRequest.current) return;
      if (error instanceof Error) {
        setFormState({ kind: 'unavailable' });
        return;
      }
      throw error;
    }
  }, [candidateId]);

  useEffect(() => { void reloadAssessment(); }, [reloadAssessment]);

  const onChange = (id: Exclude<keyof BusinessFormValues, 'requestedApiPurposes'>, value: string) => {
    setValues((current) => ({ ...current, [id]: value }));
  };

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (formState.kind !== 'ready') return;
    const parsed = businessEvidenceFrom(values, savedEvidence);
    if (parsed.kind === 'invalid') {
      setNotice(parsed.message);
      return;
    }
    setNotice(null);
    setFormState({ kind: 'saving', result: formState.result });
    try {
      const result = CandidateBusinessResultSchema.parse(await ky.post(`/api/candidates/${candidateId}/business`, {
        json: parsed.evidence, headers: adminCsrfHeaders(), credentials: 'same-origin'
      }).json<unknown>());
      setValues(initialBusinessFormValues(result.evidence));
      setSavedEvidence(result.evidence);
      setFormState({ kind: 'ready', result });
      setNotice('상업 근거를 저장했습니다.');
    } catch (error) {
      if (error instanceof Error) {
        setFormState({ kind: 'ready', result: formState.result });
        setNotice('상업 근거를 저장하지 못했습니다. 출처와 필수 값을 다시 확인하세요.');
        return;
      }
      throw error;
    }
  }

  async function copyRfqDraft(): Promise<void> {
    const parsed = businessEvidenceFrom(values, savedEvidence);
    if (parsed.kind === 'invalid' || parsed.evidence.selectedQuote === null) {
      setNotice('RFQ 초안에는 제품 사양, 수량, MOQ와 도착 단가 출처가 필요합니다.');
      return;
    }
    const quote = parsed.evidence.selectedQuote;
    const text = `RFQ draft — not sent\nSpecification: ${parsed.evidence.specification.reference}\nDescription: ${parsed.evidence.specification.description}\nQuantity: ${quote.orderQuantity}\nMOQ: ${quote.minimumOrderQuantity}\nDestination: ${quote.destination ?? 'To be confirmed'}\nPlease confirm exact specification, unit price, Incoterm, freight, duties, delivery, lead time, quote validity, and sample availability.`;
    try {
      await navigator.clipboard.writeText(text);
      setNotice('RFQ 초안을 복사했습니다. 자동 전송되지 않았으며 공급처 검증도 완료되지 않았습니다.');
    } catch (error) {
      if (error instanceof Error) {
        setNotice('브라우저가 클립보드 복사를 허용하지 않았습니다. 초안은 전송되지 않았습니다.');
        return;
      }
      throw error;
    }
  }

  if (formState.kind === 'loading') return <section className="panel business-workspace" aria-label="상업 근거"><p>현재 상업 기준과 근거를 확인하고 있습니다.</p></section>;
  if (formState.kind === 'unavailable') return <section className="panel business-workspace" aria-label="상업 근거"><p className="notice notice--error" role="alert">상업 기준을 확인할 수 없어 저장을 열지 않았습니다. 기본값으로 판단하지 않습니다.</p></section>;
  const result = formState.result;
  return <section className="panel business-workspace" aria-labelledby="business-workspace-title">
    <div className="section-heading"><div><h2 id="business-workspace-title">상업 근거 및 다음 조치</h2><p>기록된 근거만 저장하며 후보별 목표 변경, 자동 메시지·발주·작업 실행은 하지 않습니다.</p></div><button className="button button--secondary" type="button" onClick={() => void reloadAssessment()} disabled={formState.kind === 'saving'}>현재 기준 다시 확인</button></div>
    <BusinessAssessment result={result} onCopyDraft={result.assessment.stage === 'quote_ready' ? () => void copyRfqDraft() : null} />
    <form className="business-form" onSubmit={submit}>
      <CandidateBusinessInputs values={values} onChange={onChange} onRequestedApiPurposes={(requestedApiPurposes) => setValues((current) => ({ ...current, requestedApiPurposes }))} />
      <p className="field-help">추정과 견적은 구분해 저장합니다. 비어 있는 금액은 $0이 아니라 미확인으로 남습니다.</p>
      <button className="button button--primary" type="submit" disabled={formState.kind === 'saving'}>{formState.kind === 'saving' ? '상업 근거 저장 중…' : '상업 근거 저장'}</button>
      {notice ? <p className={notice === '상업 근거를 저장했습니다.' ? 'notice notice--success' : 'notice'} role="status">{notice}</p> : null}
    </form>
  </section>;
}
