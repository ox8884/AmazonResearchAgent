import { z } from 'zod';
import { JungleScoutEndpointSchema } from './jungle-scout';

const NonNegativeMoneySchema = z.number().finite().nonnegative();
const PositiveIntegerSchema = z.number().finite().int().positive();
const PercentageSchema = z.number().finite().min(0).max(100);
const ReferenceSchema = z.string().trim().min(1).max(500);
const TextSchema = z.string().trim().min(1).max(2_000);
const HttpUrlSchema = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'URL must use http or https.');

export const DEFAULT_RESEARCH_LAUNCH_BUDGET_USD = 3000;
export const ResearchLaunchBudgetSchema = z.number().finite().positive();

export const ResearchBusinessSourceSchema = z.object({
  reference: ReferenceSchema,
  url: HttpUrlSchema.nullable(),
  recordedAt: z.string().datetime(),
  basis: z.enum(['estimate', 'quote', 'observed'])
}).strict();
export type ResearchBusinessSource = z.infer<typeof ResearchBusinessSourceSchema>;

export const ResearchBusinessMoneySchema = z.object({
  amount: NonNegativeMoneySchema.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  amountUsd: NonNegativeMoneySchema.nullable(),
  source: ResearchBusinessSourceSchema.nullable(),
  usdConversionSource: ResearchBusinessSourceSchema.nullable()
}).strict().superRefine((money, context) => {
  const values = [money.amount, money.currency, money.amountUsd, money.source];
  const hasValue = values.some((value) => value !== null);
  if (!hasValue) {
    if (money.usdConversionSource !== null) {
      context.addIssue({ code: 'custom', path: ['usdConversionSource'], message: 'Unknown money cannot have a conversion source.' });
    }
    return;
  }
  if (values.some((value) => value === null)) {
    context.addIssue({ code: 'custom', message: 'Known money requires amount, currency, USD amount, and source.' });
    return;
  }
  if (money.currency === 'USD') {
    if (money.amount !== money.amountUsd) {
      context.addIssue({ code: 'custom', path: ['amountUsd'], message: 'USD amount must equal the source amount.' });
    }
    if (money.usdConversionSource !== null) {
      context.addIssue({ code: 'custom', path: ['usdConversionSource'], message: 'USD money cannot include a conversion source.' });
    }
    return;
  }
  if (money.usdConversionSource === null) {
    context.addIssue({ code: 'custom', path: ['usdConversionSource'], message: 'Non-USD money requires an explicit USD conversion source.' });
  }
});
export type ResearchBusinessMoney = z.infer<typeof ResearchBusinessMoneySchema>;

const CheckStatusSchema = z.enum(['unknown', 'pass', 'fail']);
const ResearchBusinessCheckSchema = z.object({
  status: CheckStatusSchema,
  source: ResearchBusinessSourceSchema.nullable()
}).strict().superRefine((check, context) => {
  if (check.status === 'unknown' && check.source !== null) {
    context.addIssue({ code: 'custom', path: ['source'], message: 'Unknown checks cannot claim a source.' });
  }
  if (check.status !== 'unknown' && check.source === null) {
    context.addIssue({ code: 'custom', path: ['source'], message: 'Resolved checks require a source.' });
  }
});

const MarketCheckSchema = z.object({
  status: CheckStatusSchema,
  source: ResearchBusinessSourceSchema.nullable(),
  sourcePeriod: z.object({
    from: z.string().datetime(),
    to: z.string().datetime()
  }).strict().nullable(),
  comparisonRationale: z.string().trim().min(1).max(2_000).nullable(),
  sellerEstimatedMonthlySales: z.number().finite().nonnegative().nullable(),
  sellerEstimateSource: ResearchBusinessSourceSchema.nullable()
}).strict().superRefine((market, context) => {
  if (market.status === 'unknown' && market.source !== null) {
    context.addIssue({ code: 'custom', path: ['source'], message: 'Unknown market checks cannot claim a source.' });
  }
  if (market.status !== 'unknown' && market.source === null) {
    context.addIssue({ code: 'custom', path: ['source'], message: 'Resolved market checks require a source.' });
  }
  if ((market.sellerEstimatedMonthlySales === null) !== (market.sellerEstimateSource === null)) {
    context.addIssue({ code: 'custom', path: ['sellerEstimatedMonthlySales'], message: 'Seller estimates require their own source.' });
  }
  if (market.sellerEstimateSource?.basis !== 'estimate' && market.sellerEstimateSource !== null) {
    context.addIssue({ code: 'custom', path: ['sellerEstimateSource'], message: 'Seller estimates must retain estimate basis.' });
  }
  if (market.sourcePeriod !== null && Date.parse(market.sourcePeriod.from) > Date.parse(market.sourcePeriod.to)) {
    context.addIssue({ code: 'custom', path: ['sourcePeriod'], message: 'Market evidence period must end after it starts.' });
  }
  if (market.status === 'pass' && (market.sourcePeriod === null || market.comparisonRationale === null)) {
    context.addIssue({ code: 'custom', path: ['sourcePeriod'], message: 'Market pass requires a source period and comparison rationale.' });
  }
});

const LandedCostCoverageSchema = z.object({
  product: z.enum(['included', 'excluded', 'unknown']),
  packaging: z.enum(['included', 'excluded', 'unknown']),
  freight: z.enum(['included', 'excluded', 'unknown']),
  duties: z.enum(['included', 'excluded', 'unknown']),
  delivery: z.enum(['included', 'excluded', 'unknown'])
}).strict();

const SelectedQuoteSchema = z.object({
  source: ResearchBusinessSourceSchema,
  supplierName: TextSchema.max(200),
  specificationReference: ReferenceSchema,
  orderQuantity: PositiveIntegerSchema,
  minimumOrderQuantity: PositiveIntegerSchema,
  landedUnitCost: ResearchBusinessMoneySchema,
  landedShipmentTotal: ResearchBusinessMoneySchema,
  expiresAt: z.string().datetime().nullable(),
  incoterm: z.string().trim().min(1).max(20).nullable(),
  destination: z.string().trim().min(1).max(200).nullable(),
  leadTimeDays: PositiveIntegerSchema.nullable(),
  landedCostCoverage: LandedCostCoverageSchema
}).strict().superRefine((quote, context) => {
  if (quote.source.basis === 'observed') {
    context.addIssue({ code: 'custom', path: ['source', 'basis'], message: 'Selected supply offers must be estimates or quotes.' });
  }
  if (quote.orderQuantity < quote.minimumOrderQuantity) {
    context.addIssue({ code: 'custom', path: ['orderQuantity'], message: 'Order quantity cannot be below MOQ.' });
  }
  const unitReference = quote.landedUnitCost.source?.reference;
  const totalReference = quote.landedShipmentTotal.source?.reference;
  if (unitReference !== undefined && unitReference !== quote.source.reference) {
    context.addIssue({ code: 'custom', path: ['landedUnitCost', 'source'], message: 'Unit cost must use the selected quote reference.' });
  }
  if (totalReference !== undefined && totalReference !== quote.source.reference) {
    context.addIssue({ code: 'custom', path: ['landedShipmentTotal', 'source'], message: 'Shipment total must use the selected quote reference.' });
  }
  if (quote.landedUnitCost.amountUsd !== null && quote.landedShipmentTotal.amountUsd !== null) {
    const expectedTotal = quote.orderQuantity * quote.landedUnitCost.amountUsd;
    if (Math.abs(expectedTotal - quote.landedShipmentTotal.amountUsd) > 0.01) {
      context.addIssue({ code: 'custom', path: ['landedShipmentTotal', 'amountUsd'], message: 'Shipment total must match the selected quantity and unit landed cost.' });
    }
  }
});

export const ResearchBusinessEvidenceSchema = z.object({
  kind: z.literal('research_business_v1'),
  specification: z.object({ reference: ReferenceSchema, description: TextSchema }).strict(),
  marketplace: z.literal('US'),
  brandFit: ResearchBusinessCheckSchema,
  disposition: z.enum(['research', 'awaiting_quote', 'awaiting_sample', 'rejected']),
  salePrice: ResearchBusinessMoneySchema,
  amazonUnitCosts: z.object({
    referralFee: ResearchBusinessMoneySchema,
    fulfillmentFee: ResearchBusinessMoneySchema,
    otherVariableCost: ResearchBusinessMoneySchema
  }).strict(),
  selectedQuote: SelectedQuoteSchema.nullable(),
  upfrontLaunchCost: ResearchBusinessMoneySchema,
  launchAdvertisingCash: ResearchBusinessMoneySchema,
  launchReserveCash: ResearchBusinessMoneySchema,
  perUnitAdCost: ResearchBusinessMoneySchema,
  perUnitReturnCost: ResearchBusinessMoneySchema,
  minimumProfitabilityPolicy: z.object({
    minimumPreAdMarginPct: PercentageSchema.nullable(),
    minimumPostAdMarginPct: PercentageSchema.nullable(),
    minimumRoiPct: NonNegativeMoneySchema.nullable(),
    source: ResearchBusinessSourceSchema.nullable()
  }).strict(),
  marketCheck: MarketCheckSchema,
  sampleCheck: ResearchBusinessCheckSchema,
  safetyIpCheck: ResearchBusinessCheckSchema,
  requestedApiPurposes: z.array(JungleScoutEndpointSchema).max(10)
}).strict().superRefine((evidence, context) => {
  const policyValues = [
    evidence.minimumProfitabilityPolicy.minimumPreAdMarginPct,
    evidence.minimumProfitabilityPolicy.minimumPostAdMarginPct,
    evidence.minimumProfitabilityPolicy.minimumRoiPct
  ];
  const hasPolicyValue = policyValues.some((value) => value !== null);
  if (hasPolicyValue && (policyValues.some((value) => value === null) || evidence.minimumProfitabilityPolicy.source === null)) {
    context.addIssue({ code: 'custom', path: ['minimumProfitabilityPolicy'], message: 'A profitability policy requires all thresholds and a source.' });
  }
  if (!hasPolicyValue && evidence.minimumProfitabilityPolicy.source !== null) {
    context.addIssue({ code: 'custom', path: ['minimumProfitabilityPolicy', 'source'], message: 'Unknown profitability policy cannot claim a source.' });
  }
  if (evidence.selectedQuote?.specificationReference !== undefined && evidence.selectedQuote.specificationReference !== evidence.specification.reference) {
    context.addIssue({ code: 'custom', path: ['selectedQuote', 'specificationReference'], message: 'Selected quote must reference the current specification.' });
  }
});
export type ResearchBusinessEvidence = z.infer<typeof ResearchBusinessEvidenceSchema>;
export type ResearchBusinessEvidenceInput = z.input<typeof ResearchBusinessEvidenceSchema>;

export type ResearchBusinessEvidenceRow = {
  readonly id: string;
  readonly created_at: string;
  readonly payload: unknown;
};

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function selectLatestResearchBusiness(rows: readonly ResearchBusinessEvidenceRow[]): ResearchBusinessEvidence | null {
  let latest: ResearchBusinessEvidenceRow | null = null;
  for (const row of rows) {
    if (latest === null || timestamp(row.created_at) > timestamp(latest.created_at) || (timestamp(row.created_at) === timestamp(latest.created_at) && row.id > latest.id)) {
      latest = row;
    }
  }
  if (latest === null) return null;
  const parsed = ResearchBusinessEvidenceSchema.safeParse(latest.payload);
  return parsed.success ? parsed.data : null;
}
