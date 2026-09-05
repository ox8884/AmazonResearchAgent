import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appendCandidateBusiness,
  getCandidateBusiness
} from '../../../apps/web/lib/server/candidate-business';

const databaseUrl = process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = postgres(databaseUrl, { max: 2 });

function businessEvidence(description: string) {
  return {
    kind: 'research_business_v1' as const,
    specification: { reference: 'spec-1', description },
    marketplace: 'US' as const,
    brandFit: { status: 'unknown' as const, source: null },
    disposition: 'research' as const,
    salePrice: { amount: null, currency: null, amountUsd: null, source: null, usdConversionSource: null },
    amazonUnitCosts: {
      referralFee: { amount: null, currency: null, amountUsd: null, source: null, usdConversionSource: null },
      fulfillmentFee: { amount: null, currency: null, amountUsd: null, source: null, usdConversionSource: null },
      otherVariableCost: { amount: null, currency: null, amountUsd: null, source: null, usdConversionSource: null }
    },
    selectedQuote: null,
    upfrontLaunchCost: { amount: null, currency: null, amountUsd: null, source: null, usdConversionSource: null },
    launchAdvertisingCash: { amount: null, currency: null, amountUsd: null, source: null, usdConversionSource: null },
    launchReserveCash: { amount: null, currency: null, amountUsd: null, source: null, usdConversionSource: null },
    perUnitAdCost: { amount: null, currency: null, amountUsd: null, source: null, usdConversionSource: null },
    perUnitReturnCost: { amount: null, currency: null, amountUsd: null, source: null, usdConversionSource: null },
    marketCheck: {
      status: 'unknown' as const,
      source: null,
      sourcePeriod: null,
      comparisonRationale: null,
      sellerEstimatedMonthlySales: null,
      sellerEstimateSource: null
    },
    sampleCheck: { status: 'unknown' as const, source: null },
    safetyIpCheck: { status: 'unknown' as const, source: null },
    requestedApiPurposes: []
  };
}

async function seedCandidate(): Promise<{ candidateId: string; state: string }> {
  const importRunId = randomUUID();
  const candidateId = randomUUID();
  const keyword = `candidate-business-${randomUUID()}`;
  await sql`insert into import_runs (id, submission_hash) values (${importRunId}, ${keyword})`;
  await sql`
    insert into candidates (
      id, import_run_id, keyword, normalized_exact_keyword, state, rule_passed
    ) values (
      ${candidateId}, ${importRunId}, ${keyword}, ${keyword}, 'Discovered', true
    )
  `;
  return { candidateId, state: 'Discovered' };
}

afterAll(async () => {
  await sql.end();
});

describe('candidate business persistence integration', () => {
  it('appends revisions, rereads the latest valid evidence, and fails closed on a malformed latest revision', async () => {
    const candidate = await seedCandidate();
    await appendCandidateBusiness(candidate.candidateId, businessEvidence('first persisted specification'));
    await appendCandidateBusiness(candidate.candidateId, businessEvidence('second persisted specification'));

    const validRead = await getCandidateBusiness(candidate.candidateId);
    const [beforeMalformed] = await sql<{
      state: string;
      evidence_count: number;
    }[]>`
      select c.state, count(e.id)::integer as evidence_count
      from candidates c
      left join candidate_evidence e on e.candidate_id = c.id
      where c.id = ${candidate.candidateId}
      group by c.state
    `;

    expect(validRead.evidence?.specification.description).toBe('second persisted specification');
    expect(beforeMalformed).toEqual({ state: candidate.state, evidence_count: 2 });

    await sql`
      insert into candidate_evidence (candidate_id, kind, payload, created_at)
      values (
        ${candidate.candidateId}, 'research_business_v1',
        ${sql.json({ kind: 'research_business_v1' })}, clock_timestamp() + interval '1 second'
      )
    `;

    const malformedLatestRead = await getCandidateBusiness(candidate.candidateId);
    const [afterMalformed] = await sql<{
      state: string;
      evidence_count: number;
    }[]>`
      select c.state, count(e.id)::integer as evidence_count
      from candidates c
      left join candidate_evidence e on e.candidate_id = c.id
      where c.id = ${candidate.candidateId}
      group by c.state
    `;

    expect(malformedLatestRead.evidence).toBeNull();
    expect(malformedLatestRead.assessment.gaps).toContain('business_evidence');
    expect(afterMalformed).toEqual({ state: candidate.state, evidence_count: 3 });
  });

  it('does not append evidence when the singleton settings row is missing', async () => {
    const candidate = await seedCandidate();
    await sql`delete from app_settings where id = true`;

    await expect(
      appendCandidateBusiness(candidate.candidateId, businessEvidence('must not persist'))
    ).rejects.toMatchObject({ kind: 'unavailable' });
    const [stored] = await sql<{ evidence_count: number }[]>`
      select count(*)::integer as evidence_count
      from candidate_evidence where candidate_id = ${candidate.candidateId}
    `;
    expect(stored?.evidence_count).toBe(0);
  });
});
