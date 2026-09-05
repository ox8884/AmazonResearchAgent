import { z } from 'zod';

export type EvidenceRecord = {
  readonly id?: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly created_at?: string;
};

const KeywordSchema = z.object({ monthlySearchVolume: z.number().nonnegative().nullable(), isUpperBound: z.boolean().optional() });
const EconomicsSchema = z.object({
  salePrice: z.number().positive().nullable(),
  amazonFees: z.number().nonnegative().nullable(),
  economicsSource: z.enum(['supplier_verified', 'estimated_assumption']).optional()
});
const VerdictSchema = z.object({
  total: z.number().min(0).max(100),
  verdict: z.enum(['Reject', 'Watch', 'Needs Review', 'strong_potential']),
  reasons: z.array(z.string()),
  candidateState: z.string().optional()
});
const ReviewSchema = z.object({ notes: z.string().trim().min(1) });
const AnalysisSchema = z.object({
  quality: z.enum(['ok', 'insufficient_history', 'unmapped_brands', 'insufficient_share']),
  source: z.string(),
  observedOrEstimated: z.enum(['observed', 'estimated']),
  confidence: z.enum(['high', 'low']),
  sourcePeriod: z.object({ from: z.string().nullable(), to: z.string().nullable() }),
  consistency: z.number().min(0).max(1).nullable().optional(),
  seasonal: z.boolean().nullable().optional(),
  salesStability: z.number().min(0).max(1).nullable().optional(),
  priceStability: z.number().min(0).max(1).nullable().optional(),
  brandDominance: z.number().min(0).max(1).nullable().optional(),
  topBrand: z.string().nullable().optional()
});

export type EvidenceAnalysis = z.infer<typeof AnalysisSchema>;
export type EvidenceStatus = 'none' | 'partial' | 'missing_required' | 'reviewable';
export const EVIDENCE_RECORD_LIMIT = 200;
export type CandidateEvidenceView =
  | { readonly kind: 'unavailable' }
  | {
      readonly kind: 'ready';
      readonly completeness: 'complete' | 'truncated';
      readonly records: readonly EvidenceRecord[];
      readonly summary: CandidateEvidenceSummary;
    };

export function projectCandidateEvidence(rows: readonly EvidenceRecord[]): Extract<CandidateEvidenceView, { kind: 'ready' }> {
  const records = rows.slice(0, EVIDENCE_RECORD_LIMIT);
  return {
    kind: 'ready',
    completeness: rows.length > EVIDENCE_RECORD_LIMIT ? 'truncated' : 'complete',
    records,
    summary: summarizeCandidateEvidence(records)
  };
}
export type EvidenceGap = 'sale_price' | 'amazon_fees' | 'review_text' | 'analysis' | 'verified_economics';
export type CandidateEvidenceSummary = {
  readonly status: EvidenceStatus;
  readonly collectedKinds: readonly string[];
  readonly gaps: readonly EvidenceGap[];
  readonly monthlySearchVolume: number | null;
  readonly searchVolumeIsUpperBound: boolean | null;
  readonly salePrice: number | null;
  readonly amazonFees: number | null;
  readonly economicsSource: 'supplier_verified' | 'estimated_assumption' | null;
  readonly analysisScore: number | null;
  readonly recordedVerdict: z.infer<typeof VerdictSchema>['verdict'] | null;
  readonly reasons: readonly string[];
  readonly analyses: readonly EvidenceAnalysis[];
  /** This display projection never authorizes sourcing or changes candidate state. */
  readonly purchaseApproved: false;
};

const COLLECTION_SCHEMAS = {
  relevant_asins: z.object({ asins: z.array(z.string()).min(1), parentKeys: z.array(z.string()).optional() }),
  historical_search_volume: z.object({ points: z.array(z.object({
    periodStart: z.string(), periodEnd: z.string(), searchVolume: z.number().nonnegative().nullable()
  })).min(1) }),
  sales_estimates: z.object({ estimates: z.array(z.object({
    asin: z.string(), estimatedMonthlySales: z.number().nonnegative().nullable(),
    dailySales: z.array(z.number().nonnegative()).optional(), prices: z.array(z.number().nonnegative()).optional()
  })).min(1) }),
  share_of_voice: z.object({ brands: z.array(z.object({ brand: z.string(), share: z.number().nonnegative().nullable() })).min(1) }),
  micro_niches: z.array(z.object({ name: z.string(), priceSegments: z.array(z.object({
    label: z.string(), minPrice: z.number(), maxPrice: z.number(), familyCount: z.number().int().nonnegative()
  })) })).min(1)
} as const;

const DISCLOSURE_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  ...COLLECTION_SCHEMAS, keyword_metrics: KeywordSchema,
  economics: EconomicsSchema, economics_verified: EconomicsSchema,
  analysis_verdict: VerdictSchema, review_text: ReviewSchema,
  historical_search_volume_analysis: AnalysisSchema,
  sales_estimates_analysis: AnalysisSchema, share_of_voice_analysis: AnalysisSchema
};

export function readableEvidencePayload(record: EvidenceRecord): unknown {
  const parsed = DISCLOSURE_SCHEMAS[record.kind]?.safeParse(record.payload);
  return parsed?.success ? parsed.data : null;
}

/** Latest payload per kind wins, including incomplete or malformed newer records. */
export function latestEvidence(records: readonly EvidenceRecord[]): ReadonlyMap<string, EvidenceRecord> {
  const latest = new Map<string, EvidenceRecord>();
  for (const record of records) {
    const previous = latest.get(record.kind);
    const currentTime = record.created_at ? Date.parse(record.created_at) : 0;
    const previousTime = previous?.created_at ? Date.parse(previous.created_at) : 0;
    if (!previous || currentTime > previousTime ||
      (currentTime === previousTime && (record.id ?? '') > (previous.id ?? ''))) {
      latest.set(record.kind, record);
    }
  }
  return latest;
}

/**
 * Presentation readiness is not a new business gate. A reviewable packet has
 * a recorded non-provisional verdict, verified price/fees and review material.
 * DDP, MOQ, launch cash, fees, samples and IP still require purchase validation.
 */
export function summarizeCandidateEvidence(records: readonly EvidenceRecord[]): CandidateEvidenceSummary {
  const latest = latestEvidence(records);
  const keyword = KeywordSchema.safeParse(latest.get('keyword_metrics')?.payload);
  const verdict = VerdictSchema.safeParse(latest.get('analysis_verdict')?.payload);
  const verified = EconomicsSchema.safeParse(latest.get('economics_verified')?.payload);
  const estimated = EconomicsSchema.safeParse(latest.get('economics')?.payload);
  const economics = verified.success ? verified.data : estimated.success ? estimated.data : null;
  const review = ReviewSchema.safeParse(latest.get('review_text')?.payload);
  const collected = new Set<string>();
  const analyses: EvidenceAnalysis[] = [];
  for (const [kind, schema] of Object.entries(COLLECTION_SCHEMAS)) {
    if (schema.safeParse(latest.get(kind)?.payload).success) collected.add(kind);
  }
  for (const kind of ['historical_search_volume_analysis', 'sales_estimates_analysis', 'share_of_voice_analysis']) {
    const parsed = AnalysisSchema.safeParse(latest.get(kind)?.payload);
    if (parsed.success) {
      analyses.push(parsed.data);
      collected.add(kind);
    }
  }
  if (keyword.success && keyword.data.monthlySearchVolume !== null) collected.add('keyword_metrics');
  if (verdict.success) collected.add('analysis_verdict');
  if (review.success) collected.add('review_text');
  if (economics && (economics.salePrice !== null || economics.amazonFees !== null)) {
    collected.add(verified.success ? 'economics_verified' : 'economics');
  }
  const salePrice = economics?.salePrice ?? null;
  const amazonFees = economics?.amazonFees ?? null;
  const gaps: EvidenceGap[] = [];
  if (salePrice === null) gaps.push('sale_price');
  if (amazonFees === null) gaps.push('amazon_fees');
  if (!review.success) gaps.push('review_text');
  if (!verdict.success) gaps.push('analysis');
  if (!verified.success || verified.data.economicsSource !== 'supplier_verified') {
    gaps.push('verified_economics');
  }
  const reviewable = gaps.length === 0 && verified.success &&
    verified.data.economicsSource === 'supplier_verified' && verdict.success &&
    verdict.data.verdict !== 'Needs Review' && verdict.data.reasons.length === 0;
  const status: EvidenceStatus = collected.size === 0 ? 'none'
    : reviewable ? 'reviewable'
      : verdict.success ? 'missing_required' : 'partial';
  return {
    status,
    collectedKinds: [...collected],
    gaps,
    monthlySearchVolume: keyword.success ? keyword.data.monthlySearchVolume : null,
    searchVolumeIsUpperBound: keyword.success ? keyword.data.isUpperBound ?? null : null,
    salePrice,
    amazonFees,
    economicsSource: economics?.economicsSource ?? null,
    analysisScore: verdict.success ? verdict.data.total : null,
    recordedVerdict: verdict.success ? verdict.data.verdict : null,
    reasons: verdict.success ? verdict.data.reasons : [],
    analyses,
    purchaseApproved: false
  };
}
