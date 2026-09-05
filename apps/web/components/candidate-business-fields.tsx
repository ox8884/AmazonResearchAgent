import type { ChangeEvent } from 'react';
import type { BusinessFormValues } from './candidate-business-values';

type EditableTextField = Exclude<keyof BusinessFormValues, 'requestedApiPurposes'>;

const endpointOptions = [
  ['product_database', 'Product Database'], ['keywords_by_keyword', 'Keywords by keyword'], ['historical_search_volume', 'Historical search volume'], ['sales_estimates', 'Sales estimates'], ['share_of_voice', 'Share of voice']
] as const;

function MoneyField({ id, label, value, onChange }: { readonly id: EditableTextField; readonly label: string; readonly value: string; readonly onChange: (id: EditableTextField, value: string) => void }) {
  return <div className="field-stack"><label htmlFor={id}>{label}</label><input id={id} type="number" min="0" step="0.01" value={value} onChange={(event) => onChange(id, event.currentTarget.value)} /></div>;
}

function StatusField({ id, label, value, onChange }: { readonly id: EditableTextField; readonly label: string; readonly value: BusinessFormValues['brandFitStatus']; readonly onChange: (id: EditableTextField, value: string) => void }) {
  return <div className="field-stack"><label htmlFor={id}>{label}</label><select id={id} value={value} onChange={(event) => onChange(id, event.currentTarget.value)}><option value="unknown">미확인</option><option value="pass">통과</option><option value="fail">미통과</option></select></div>;
}

export function CandidateBusinessInputs({ values, onChange, onRequestedApiPurposes }: { readonly values: BusinessFormValues; readonly onChange: (id: EditableTextField, value: string) => void; readonly onRequestedApiPurposes: (value: readonly string[]) => void }) {
  const toggleEndpoint = (event: ChangeEvent<HTMLInputElement>) => onRequestedApiPurposes(event.currentTarget.checked ? [...values.requestedApiPurposes, event.currentTarget.value] : values.requestedApiPurposes.filter((endpoint) => endpoint !== event.currentTarget.value));
  return <>
    <fieldset className="business-form__group" id="business-specification"><legend>제품·사양</legend><div className="form-grid">
      <div className="field-stack field-stack--wide"><label htmlFor="specificationReference">제품 사양 레퍼런스</label><input id="specificationReference" value={values.specificationReference} onChange={(event) => onChange('specificationReference', event.currentTarget.value)} /></div>
      <div className="field-stack field-stack--wide"><label htmlFor="specificationDescription">제품 사양 설명</label><input id="specificationDescription" value={values.specificationDescription} onChange={(event) => onChange('specificationDescription', event.currentTarget.value)} /></div>
      <MoneyField id="salePrice" label="판매가 (USD)" value={values.salePrice} onChange={onChange} /><StatusField id="brandFitStatus" label="브랜드 적합성" value={values.brandFitStatus} onChange={onChange} />
    </div></fieldset>
    <fieldset className="business-form__group"><legend>출처·비교군</legend><div className="form-grid">
      <div className="field-stack"><label htmlFor="sourceReference">금액·견적 출처 레퍼런스</label><input id="sourceReference" value={values.sourceReference} onChange={(event) => onChange('sourceReference', event.currentTarget.value)} /></div>
      <div className="field-stack"><label htmlFor="sourceUrl">출처 URL</label><input id="sourceUrl" type="url" placeholder="https://" value={values.sourceUrl} onChange={(event) => onChange('sourceUrl', event.currentTarget.value)} /></div>
      <div className="field-stack"><label htmlFor="sourceBasis">출처 성격</label><select id="sourceBasis" value={values.sourceBasis} onChange={(event) => onChange('sourceBasis', event.currentTarget.value)}><option value="estimate">추정</option><option value="quote">견적</option></select></div>
      <p className="field-help">검색·공급처 링크는 검증된 공급업체를 뜻하지 않습니다. 저장 시각은 제공처의 관측 기간과 다릅니다.</p>
    </div></fieldset>
    <fieldset className="business-form__group" id="business-quote"><legend>수량·견적</legend><div className="form-grid">
      <div className="field-stack"><label htmlFor="supplierName">공급처 이름</label><input id="supplierName" value={values.supplierName} onChange={(event) => onChange('supplierName', event.currentTarget.value)} /></div>
      <div className="field-stack"><label htmlFor="orderQuantity">수량</label><input id="orderQuantity" type="number" min="1" step="1" value={values.orderQuantity} onChange={(event) => onChange('orderQuantity', event.currentTarget.value)} /></div>
      <div className="field-stack"><label htmlFor="minimumOrderQuantity">MOQ</label><input id="minimumOrderQuantity" type="number" min="1" step="1" value={values.minimumOrderQuantity} onChange={(event) => onChange('minimumOrderQuantity', event.currentTarget.value)} /></div>
      <MoneyField id="landedUnitCost" label="도착 단가 (USD)" value={values.landedUnitCost} onChange={onChange} /><MoneyField id="landedShipmentTotal" label="도착 총액 (USD)" value={values.landedShipmentTotal} onChange={onChange} />
      <div className="field-stack"><label htmlFor="incoterm">Incoterm</label><input id="incoterm" value={values.incoterm} onChange={(event) => onChange('incoterm', event.currentTarget.value)} /></div><div className="field-stack"><label htmlFor="destination">도착지</label><input id="destination" value={values.destination} onChange={(event) => onChange('destination', event.currentTarget.value)} /></div>
      <div className="field-stack"><label htmlFor="leadTimeDays">리드타임 (일)</label><input id="leadTimeDays" type="number" min="1" step="1" value={values.leadTimeDays} onChange={(event) => onChange('leadTimeDays', event.currentTarget.value)} /></div><div className="field-stack"><label htmlFor="quoteExpiresAt">견적 만료</label><input id="quoteExpiresAt" type="datetime-local" value={values.quoteExpiresAt} onChange={(event) => onChange('quoteExpiresAt', event.currentTarget.value)} /></div>
    </div></fieldset>
    <fieldset className="business-form__group"><legend>출시 현금·단위 비용</legend><div className="form-grid">
      <MoneyField id="referralFee" label="Amazon referral fee (USD)" value={values.referralFee} onChange={onChange} /><MoneyField id="fulfillmentFee" label="FBA fulfillment fee (USD)" value={values.fulfillmentFee} onChange={onChange} /><MoneyField id="otherVariableCost" label="Other variable cost (USD)" value={values.otherVariableCost} onChange={onChange} /><MoneyField id="perUnitAdCost" label="예상 단위 광고비 (USD)" value={values.perUnitAdCost} onChange={onChange} /><MoneyField id="perUnitReturnCost" label="예상 단위 반품비 (USD)" value={values.perUnitReturnCost} onChange={onChange} /><MoneyField id="upfrontLaunchCost" label="선행 출시 비용 (USD)" value={values.upfrontLaunchCost} onChange={onChange} /><MoneyField id="launchAdvertisingCash" label="출시 광고 현금 (USD)" value={values.launchAdvertisingCash} onChange={onChange} /><MoneyField id="launchReserveCash" label="출시 예비 현금 (USD)" value={values.launchReserveCash} onChange={onChange} />
    </div></fieldset>
    <p className="field-help">기존 레코드의 필드별 통화·USD 환산·출처·관측 시각·배송 포함 범위는 값이 바뀌지 않으면 원문 그대로 보존됩니다. 수량을 바꾸면 새 도착 총액을 명시적으로 입력해야 하며 자동 재계산하지 않습니다.</p>
    <fieldset className="business-form__group" id="business-market"><legend>시장·체크</legend><div className="form-grid">
      <StatusField id="marketStatus" label="시장 검증" value={values.marketStatus} onChange={onChange} /><div className="field-stack"><label htmlFor="marketPeriodFrom">관측 시작</label><input id="marketPeriodFrom" type="datetime-local" value={values.marketPeriodFrom} onChange={(event) => onChange('marketPeriodFrom', event.currentTarget.value)} /></div><div className="field-stack"><label htmlFor="marketPeriodTo">관측 종료</label><input id="marketPeriodTo" type="datetime-local" value={values.marketPeriodTo} onChange={(event) => onChange('marketPeriodTo', event.currentTarget.value)} /></div>
      <div className="field-stack field-stack--wide"><label htmlFor="comparisonRationale">비교 근거</label><input id="comparisonRationale" value={values.comparisonRationale} onChange={(event) => onChange('comparisonRationale', event.currentTarget.value)} /></div><StatusField id="sampleStatus" label="샘플 확인" value={values.sampleStatus} onChange={onChange} /><StatusField id="safetyIpStatus" label="안전·IP 확인" value={values.safetyIpStatus} onChange={onChange} />
      <fieldset className="business-form__intent"><legend>저장할 Jungle Scout endpoint 요청 의도</legend>{endpointOptions.map(([endpoint, label]) => <label className="checkbox-field" key={endpoint}><input type="checkbox" value={endpoint} checked={values.requestedApiPurposes.includes(endpoint)} onChange={toggleEndpoint} />{label}</label>)}<p className="field-help">API 호출 한도 목적이 아니라 저장할 endpoint 의도입니다. 저장 시점에는 API를 호출하지 않으며, 다음 수동·예약 리서치에서 조건을 확인합니다. 견적·샘플 대기는 자동 반복하지 않습니다.</p></fieldset>
    </div></fieldset>
  </>;
}
