import { ResearchBusinessEvidenceSchema, type ResearchBusinessEvidence, type ResearchBusinessSource } from '@ara/shared';

type CheckStatus = 'unknown' | 'pass' | 'fail';
type SourceBasis = 'estimate' | 'quote';
type MarketSourceBasis = ResearchBusinessSource['basis'];
type LandedCostCoverage = NonNullable<ResearchBusinessEvidence['selectedQuote']>['landedCostCoverage'];

export type BusinessFormValues = {
  readonly specificationReference: string; readonly specificationDescription: string; readonly sourceReference: string; readonly sourceUrl: string; readonly sourceBasis: SourceBasis;
  readonly marketSourceReference: string; readonly marketSourceUrl: string; readonly marketSourceBasis: MarketSourceBasis; readonly marketSourceRecordedAt: string;
  readonly disposition: ResearchBusinessEvidence['disposition'];
  readonly salePrice: string; readonly referralFee: string; readonly fulfillmentFee: string; readonly otherVariableCost: string; readonly perUnitAdCost: string; readonly perUnitReturnCost: string;
  readonly supplierName: string; readonly orderQuantity: string; readonly minimumOrderQuantity: string; readonly landedUnitCost: string; readonly landedShipmentTotal: string;
  readonly upfrontLaunchCost: string; readonly launchAdvertisingCash: string; readonly launchReserveCash: string; readonly incoterm: string; readonly destination: string; readonly leadTimeDays: string; readonly quoteExpiresAt: string; readonly productCoverage: LandedCostCoverage['product']; readonly packagingCoverage: LandedCostCoverage['packaging']; readonly freightCoverage: LandedCostCoverage['freight']; readonly dutiesCoverage: LandedCostCoverage['duties']; readonly deliveryCoverage: LandedCostCoverage['delivery'];
  readonly brandFitStatus: CheckStatus; readonly marketStatus: CheckStatus; readonly marketPeriodFrom: string; readonly marketPeriodTo: string; readonly comparisonRationale: string; readonly sampleStatus: CheckStatus; readonly safetyIpStatus: CheckStatus; readonly requestedApiPurposes: readonly string[];
};

const emptyValues: BusinessFormValues = {
  specificationReference: '', specificationDescription: '', sourceReference: '', sourceUrl: '', sourceBasis: 'estimate', marketSourceReference: '', marketSourceUrl: '', marketSourceBasis: 'observed', marketSourceRecordedAt: '', salePrice: '', referralFee: '', fulfillmentFee: '', otherVariableCost: '', perUnitAdCost: '', perUnitReturnCost: '',
  disposition: 'research',
  supplierName: '', orderQuantity: '', minimumOrderQuantity: '', landedUnitCost: '', landedShipmentTotal: '', upfrontLaunchCost: '', launchAdvertisingCash: '', launchReserveCash: '', incoterm: '', destination: '', leadTimeDays: '', quoteExpiresAt: '',
  productCoverage: 'unknown', packagingCoverage: 'unknown', freightCoverage: 'unknown', dutiesCoverage: 'unknown', deliveryCoverage: 'unknown',
  brandFitStatus: 'unknown', marketStatus: 'unknown', marketPeriodFrom: '', marketPeriodTo: '', comparisonRationale: '', sampleStatus: 'unknown', safetyIpStatus: 'unknown', requestedApiPurposes: []
};

function utcInputDateTime(value: string | null): string { return value === null || Number.isNaN(Date.parse(value)) ? '' : new Date(value).toISOString().slice(0, 16); }
function amount(value: string): number | null { const parsed = Number(value); return value.trim() === '' || !Number.isFinite(parsed) ? null : parsed; }
function integer(value: string): number | null { const parsed = amount(value); return parsed !== null && Number.isInteger(parsed) ? parsed : null; }

function asSource(values: BusinessFormValues): ResearchBusinessSource | null {
  const reference = values.sourceReference.trim();
  if (reference === '') return null;
  const url = values.sourceUrl.trim();
  return { reference, url: url === '' ? null : url, recordedAt: new Date().toISOString(), basis: values.sourceBasis };
}

function utcDateTime(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const milliseconds = Date.parse(`${value}Z`);
  if (Number.isNaN(milliseconds)) return null;
  const dateTime = new Date(milliseconds).toISOString();
  return dateTime.slice(0, 16) === value ? dateTime : null;
}

function preservedUtcDateTime(value: string, initial: string, saved: string | null): string | null {
  return saved !== null && value === initial ? saved : value === '' ? null : utcDateTime(value);
}

function hasInvalidDateTime(values: BusinessFormValues): boolean {
  return [values.quoteExpiresAt, values.marketPeriodFrom, values.marketPeriodTo, values.marketSourceRecordedAt].some((value) => value !== '' && utcDateTime(value) === null);
}

function marketSource(values: BusinessFormValues, initial: BusinessFormValues, savedSource: ResearchBusinessSource | null): ResearchBusinessSource | null {
  const reference = values.marketSourceReference.trim();
  const inputRecordedAt = values.marketSourceRecordedAt.trim();
  const recordedAt = savedSource !== null && values.marketSourceRecordedAt === initial.marketSourceRecordedAt
    ? savedSource.recordedAt
    : utcDateTime(inputRecordedAt);
  if (reference === '' || recordedAt === null) return null;
  const url = values.marketSourceUrl.trim();
  return { reference, url: url === '' ? null : url, recordedAt, basis: values.marketSourceBasis };
}

function money(value: string, source: ResearchBusinessSource | null) {
  const usd = amount(value);
  return usd === null ? { amount: null, currency: null, amountUsd: null, source: null, usdConversionSource: null } : { amount: usd, currency: 'USD', amountUsd: usd, source, usdConversionSource: null };
}

function check(status: CheckStatus, source: ResearchBusinessSource | null) { return { status, source: status === 'unknown' ? null : source }; }

function coverage(values: BusinessFormValues): LandedCostCoverage {
  return { product: values.productCoverage, packaging: values.packagingCoverage, freight: values.freightCoverage, duties: values.dutiesCoverage, delivery: values.deliveryCoverage };
}

function sameQuoteSource(values: BusinessFormValues, initial: BusinessFormValues): boolean {
  return values.sourceReference === initial.sourceReference && values.sourceUrl === initial.sourceUrl && values.sourceBasis === initial.sourceBasis;
}

function sameMarketSource(values: BusinessFormValues, initial: BusinessFormValues): boolean {
  return values.marketSourceReference === initial.marketSourceReference && values.marketSourceUrl === initial.marketSourceUrl && values.marketSourceBasis === initial.marketSourceBasis && values.marketSourceRecordedAt === initial.marketSourceRecordedAt;
}

function sameQuote(values: BusinessFormValues, initial: BusinessFormValues): boolean {
  return values.supplierName === initial.supplierName && values.orderQuantity === initial.orderQuantity && values.minimumOrderQuantity === initial.minimumOrderQuantity && values.landedUnitCost === initial.landedUnitCost && values.landedShipmentTotal === initial.landedShipmentTotal && values.incoterm === initial.incoterm && values.destination === initial.destination && values.leadTimeDays === initial.leadTimeDays && values.quoteExpiresAt === initial.quoteExpiresAt;
}

function selectedQuote(values: BusinessFormValues, source: ResearchBusinessSource | null, saved: ResearchBusinessEvidence | null) {
  const hasQuoteInput = [values.supplierName, values.orderQuantity, values.minimumOrderQuantity, values.landedUnitCost, values.landedShipmentTotal].some((value) => value.trim() !== '');
  if (!hasQuoteInput) return null;
  const initial = initialBusinessFormValues(saved);
  const savedQuote = saved?.selectedQuote;
  if (savedQuote !== null && savedQuote !== undefined && sameQuote(values, initial)) {
    if (sameQuoteSource(values, initial)) return { ...savedQuote, landedCostCoverage: coverage(values) };
    return {
      ...savedQuote,
      source,
      landedUnitCost: { ...savedQuote.landedUnitCost, source },
      landedShipmentTotal: { ...savedQuote.landedShipmentTotal, source },
      landedCostCoverage: coverage(values)
    };
  }
  return {
    source, supplierName: values.supplierName, specificationReference: values.specificationReference, orderQuantity: integer(values.orderQuantity), minimumOrderQuantity: integer(values.minimumOrderQuantity),
    landedUnitCost: money(values.landedUnitCost, source), landedShipmentTotal: money(values.landedShipmentTotal, source), expiresAt: preservedUtcDateTime(values.quoteExpiresAt, initial.quoteExpiresAt, savedQuote?.expiresAt ?? null),
    incoterm: values.incoterm.trim() === '' ? null : values.incoterm, destination: values.destination.trim() === '' ? null : values.destination, leadTimeDays: integer(values.leadTimeDays),
    landedCostCoverage: coverage(values)
  };
}

export function initialBusinessFormValues(evidence: ResearchBusinessEvidence | null): BusinessFormValues {
  if (evidence === null) return emptyValues;
  const source = evidence.selectedQuote?.source ?? evidence.salePrice.source;
  const quote = evidence.selectedQuote;
  const savedMarketSource = evidence.marketCheck.source;
  return {
    specificationReference: evidence.specification.reference, specificationDescription: evidence.specification.description, sourceReference: source?.reference ?? '', sourceUrl: source?.url ?? '', sourceBasis: source?.basis === 'quote' ? 'quote' : 'estimate', marketSourceReference: savedMarketSource?.reference ?? '', marketSourceUrl: savedMarketSource?.url ?? '', marketSourceBasis: savedMarketSource?.basis ?? 'observed', marketSourceRecordedAt: utcInputDateTime(savedMarketSource?.recordedAt ?? null), disposition: evidence.disposition,
    salePrice: String(evidence.salePrice.amountUsd ?? ''), referralFee: String(evidence.amazonUnitCosts.referralFee.amountUsd ?? ''), fulfillmentFee: String(evidence.amazonUnitCosts.fulfillmentFee.amountUsd ?? ''), otherVariableCost: String(evidence.amazonUnitCosts.otherVariableCost.amountUsd ?? ''),
    perUnitAdCost: String(evidence.perUnitAdCost.amountUsd ?? ''), perUnitReturnCost: String(evidence.perUnitReturnCost.amountUsd ?? ''), supplierName: quote?.supplierName ?? '', orderQuantity: String(quote?.orderQuantity ?? ''), minimumOrderQuantity: String(quote?.minimumOrderQuantity ?? ''),
    landedUnitCost: String(quote?.landedUnitCost.amountUsd ?? ''), landedShipmentTotal: String(quote?.landedShipmentTotal.amountUsd ?? ''), upfrontLaunchCost: String(evidence.upfrontLaunchCost.amountUsd ?? ''), launchAdvertisingCash: String(evidence.launchAdvertisingCash.amountUsd ?? ''), launchReserveCash: String(evidence.launchReserveCash.amountUsd ?? ''),
    incoterm: quote?.incoterm ?? '', destination: quote?.destination ?? '', leadTimeDays: String(quote?.leadTimeDays ?? ''), quoteExpiresAt: utcInputDateTime(quote?.expiresAt ?? null), productCoverage: quote?.landedCostCoverage.product ?? 'unknown', packagingCoverage: quote?.landedCostCoverage.packaging ?? 'unknown', freightCoverage: quote?.landedCostCoverage.freight ?? 'unknown', dutiesCoverage: quote?.landedCostCoverage.duties ?? 'unknown', deliveryCoverage: quote?.landedCostCoverage.delivery ?? 'unknown', brandFitStatus: evidence.brandFit.status, marketStatus: evidence.marketCheck.status,
    marketPeriodFrom: utcInputDateTime(evidence.marketCheck.sourcePeriod?.from ?? null), marketPeriodTo: utcInputDateTime(evidence.marketCheck.sourcePeriod?.to ?? null), comparisonRationale: evidence.marketCheck.comparisonRationale ?? '', sampleStatus: evidence.sampleCheck.status, safetyIpStatus: evidence.safetyIpCheck.status, requestedApiPurposes: evidence.requestedApiPurposes
  };
}

function savedMoney(value: string, initial: string, saved: ResearchBusinessEvidence | null, property: 'salePrice' | 'upfrontLaunchCost' | 'launchAdvertisingCash' | 'launchReserveCash' | 'perUnitAdCost' | 'perUnitReturnCost', source: ResearchBusinessSource | null) {
  return saved !== null && value === initial ? saved[property] : money(value, source);
}

export function businessEvidenceFrom(values: BusinessFormValues, saved: ResearchBusinessEvidence | null): { readonly kind: 'valid'; readonly evidence: ResearchBusinessEvidence } | { readonly kind: 'invalid'; readonly message: string } {
  const source = asSource(values);
  const initial = initialBusinessFormValues(saved);
  if (hasInvalidDateTime(values)) return { kind: 'invalid', message: '필수 사양·출처·수량을 확인하세요. 알려진 금액과 통과한 검증에는 출처가 필요합니다.' };
  const savedMarketSource = saved?.marketCheck.source ?? null;
  const marketSourceUnchanged = saved !== null && sameMarketSource(values, initial);
  const savedMarketPeriod = saved?.marketCheck.sourcePeriod ?? null;
  const marketPeriod = values.marketPeriodFrom === '' || values.marketPeriodTo === ''
    ? null
    : {
      from: preservedUtcDateTime(values.marketPeriodFrom, initial.marketPeriodFrom, savedMarketPeriod?.from ?? null),
      to: preservedUtcDateTime(values.marketPeriodTo, initial.marketPeriodTo, savedMarketPeriod?.to ?? null)
    };
  const sameMarket = saved !== null && values.marketStatus === initial.marketStatus && values.marketPeriodFrom === initial.marketPeriodFrom && values.marketPeriodTo === initial.marketPeriodTo && values.comparisonRationale === initial.comparisonRationale && marketSourceUnchanged;
  const resolvedMarketSource = values.marketStatus === 'unknown'
    ? null
    : marketSourceUnchanged
      ? savedMarketSource
      : marketSource(values, initial, savedMarketSource);
  const parsed = ResearchBusinessEvidenceSchema.safeParse({
    kind: 'research_business_v1', specification: { reference: values.specificationReference, description: values.specificationDescription }, marketplace: 'US', disposition: values.disposition,
    brandFit: saved !== null && values.brandFitStatus === initial.brandFitStatus ? saved.brandFit : check(values.brandFitStatus, source), salePrice: savedMoney(values.salePrice, initial.salePrice, saved, 'salePrice', source),
    amazonUnitCosts: {
      referralFee: saved !== null && values.referralFee === initial.referralFee ? saved.amazonUnitCosts.referralFee : money(values.referralFee, source),
      fulfillmentFee: saved !== null && values.fulfillmentFee === initial.fulfillmentFee ? saved.amazonUnitCosts.fulfillmentFee : money(values.fulfillmentFee, source),
      otherVariableCost: saved !== null && values.otherVariableCost === initial.otherVariableCost ? saved.amazonUnitCosts.otherVariableCost : money(values.otherVariableCost, source)
    },
    selectedQuote: selectedQuote(values, source, saved), upfrontLaunchCost: savedMoney(values.upfrontLaunchCost, initial.upfrontLaunchCost, saved, 'upfrontLaunchCost', source), launchAdvertisingCash: savedMoney(values.launchAdvertisingCash, initial.launchAdvertisingCash, saved, 'launchAdvertisingCash', source), launchReserveCash: savedMoney(values.launchReserveCash, initial.launchReserveCash, saved, 'launchReserveCash', source), perUnitAdCost: savedMoney(values.perUnitAdCost, initial.perUnitAdCost, saved, 'perUnitAdCost', source), perUnitReturnCost: savedMoney(values.perUnitReturnCost, initial.perUnitReturnCost, saved, 'perUnitReturnCost', source),
    marketCheck: sameMarket ? saved.marketCheck : { status: values.marketStatus, source: resolvedMarketSource, sourcePeriod: marketPeriod, comparisonRationale: values.comparisonRationale.trim() === '' ? null : values.comparisonRationale, sellerEstimatedMonthlySales: saved?.marketCheck.sellerEstimatedMonthlySales ?? null, sellerEstimateSource: saved?.marketCheck.sellerEstimateSource ?? null },
    sampleCheck: saved !== null && values.sampleStatus === initial.sampleStatus ? saved.sampleCheck : check(values.sampleStatus, source), safetyIpCheck: saved !== null && values.safetyIpStatus === initial.safetyIpStatus ? saved.safetyIpCheck : check(values.safetyIpStatus, source), requestedApiPurposes: values.requestedApiPurposes
  });
  return parsed.success ? { kind: 'valid', evidence: parsed.data } : { kind: 'invalid', message: '필수 사양·출처·수량을 확인하세요. 알려진 금액과 통과한 검증에는 출처가 필요합니다.' };
}
