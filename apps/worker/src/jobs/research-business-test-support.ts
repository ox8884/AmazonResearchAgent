import {
  ResearchBusinessEvidenceSchema,
  type JungleScoutEndpoint,
  type ResearchBusinessEvidence,
  type ResearchBusinessSource
} from '@ara/shared';
import type { QueueDatabaseClient } from '@ara/queue';

const RECORDED_AT = '2026-09-05T00:00:00.000Z';

const unknownMoney = {
  amount: null,
  currency: null,
  amountUsd: null,
  source: null,
  usdConversionSource: null
} as const;

const observedSource = {
  reference: 'Worker test fixture',
  url: null,
  recordedAt: RECORDED_AT,
  basis: 'observed' as const
};

const quoteSource = {
  reference: 'Worker test quote',
  url: null,
  recordedAt: RECORDED_AT,
  basis: 'quote' as const
};

function knownUsd(amountUsd: number, source: ResearchBusinessSource = observedSource) {
  return {
    amount: amountUsd,
    currency: 'USD',
    amountUsd,
    source,
    usdConversionSource: null
  };
}

export function researchBusinessEvidenceFixture(input: {
  readonly requestedApiPurposes: readonly JungleScoutEndpoint[];
  readonly disposition?: ResearchBusinessEvidence['disposition'];
  readonly launchCashUsd?: number;
}): ResearchBusinessEvidence {
  const launchCashUsd = input.launchCashUsd;
  const selectedQuote =
    launchCashUsd === undefined
      ? null
      : {
          source: quoteSource,
          supplierName: 'Worker test supplier',
          specificationReference: 'worker-test-specification',
          orderQuantity: 1,
          minimumOrderQuantity: 1,
          landedUnitCost: knownUsd(0, quoteSource),
          landedShipmentTotal: knownUsd(0, quoteSource),
          expiresAt: null,
          incoterm: null,
          destination: null,
          leadTimeDays: null,
          landedCostCoverage: {
            product: 'unknown' as const,
            packaging: 'unknown' as const,
            freight: 'unknown' as const,
            duties: 'unknown' as const,
            delivery: 'unknown' as const
          }
        };
  return ResearchBusinessEvidenceSchema.parse({
    kind: 'research_business_v1',
    specification: {
      reference: 'worker-test-specification',
      description: 'Worker research admission fixture'
    },
    marketplace: 'US',
    brandFit: { status: 'pass', source: observedSource },
    disposition: input.disposition ?? 'research',
    salePrice: unknownMoney,
    amazonUnitCosts: {
      referralFee: unknownMoney,
      fulfillmentFee: unknownMoney,
      otherVariableCost: unknownMoney
    },
    selectedQuote,
    upfrontLaunchCost: launchCashUsd === undefined ? unknownMoney : knownUsd(launchCashUsd),
    launchAdvertisingCash: launchCashUsd === undefined ? unknownMoney : knownUsd(0),
    launchReserveCash: launchCashUsd === undefined ? unknownMoney : knownUsd(0),
    perUnitAdCost: unknownMoney,
    perUnitReturnCost: unknownMoney,
    marketCheck: {
      status: 'unknown',
      source: null,
      sourcePeriod: null,
      comparisonRationale: null,
      sellerEstimatedMonthlySales: null,
      sellerEstimateSource: null
    },
    sampleCheck: { status: 'unknown', source: null },
    safetyIpCheck: { status: 'unknown', source: null },
    requestedApiPurposes: [...input.requestedApiPurposes]
  });
}

export async function appendResearchBusinessEvidence(
  client: QueueDatabaseClient,
  candidateId: string,
  input: {
    readonly requestedApiPurposes: readonly JungleScoutEndpoint[];
    readonly disposition?: ResearchBusinessEvidence['disposition'];
    readonly launchCashUsd?: number;
  }
): Promise<ResearchBusinessEvidence> {
  const evidence = researchBusinessEvidenceFixture(input);
  const { error } = await client.from('candidate_evidence').insert({
    candidate_id: candidateId,
    kind: 'research_business_v1',
    payload: evidence
  });
  if (error) {
    throw new Error(`Could not append worker business evidence: ${error.message}`);
  }
  return evidence;
}
