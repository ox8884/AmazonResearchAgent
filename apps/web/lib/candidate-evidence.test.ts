import { describe, expect, it } from 'vitest';
import { projectCandidateEvidence, readableEvidencePayload, summarizeCandidateEvidence } from './candidate-evidence';

const row = (kind: string, payload: unknown, created_at = '2026-09-04T12:00:00Z') =>
  ({ kind, payload, created_at });

describe('candidate evidence presentation', () => {
  it('only exposes recognized research fields in technical disclosure', () => {
    const payload = readableEvidencePayload(row('keyword_metrics', {
      monthlySearchVolume: 311, isUpperBound: true, authorization: 'private-fixture-marker'
    }));
    expect(payload).toEqual({ monthlySearchVolume: 311, isUpperBound: true });
    expect(readableEvidencePayload(row('unknown', { secret: 'private-fixture-marker' }))).toBeNull();
  });
  it('preserves an upper-bound search volume marker', () => {
    const summary = summarizeCandidateEvidence([row('keyword_metrics', { monthlySearchVolume: 311, isUpperBound: true })]);
    expect(summary.searchVolumeIsUpperBound).toBe(true);
  });
  it('marks a capped read as incomplete instead of claiming no evidence', () => {
    const rows = Array.from({ length: 201 }, () => row('future_kind', {}));
    const view = projectCandidateEvidence(rows);
    expect(view.completeness).toBe('truncated');
    expect(view.records).toHaveLength(200);
    expect(view.summary.status).not.toBe('reviewable');
  });
  it('keeps an empty packet distinct from collected evidence', () => {
    const summary = summarizeCandidateEvidence([]);
    expect(summary.status).toBe('none');
    expect(summary.collectedKinds).toEqual([]);
    expect(summary.analysisScore).toBeNull();
  });

  it('retains fee-only evidence as partial collection', () => {
    const summary = summarizeCandidateEvidence([row('economics', {
      salePrice: null, amazonFees: 7.5, economicsSource: 'estimated_assumption'
    })]);
    expect(summary.status).toBe('partial');
    expect(summary.collectedKinds).toContain('economics');
    expect(summary.gaps).not.toContain('amazon_fees');
  });

  it('reports partial collection without inventing a decision from search volume', () => {
    const summary = summarizeCandidateEvidence([
      row('keyword_metrics', { monthlySearchVolume: 311, status: 200 })
    ]);
    expect(summary.status).toBe('partial');
    expect(summary.monthlySearchVolume).toBe(311);
    expect(summary.recordedVerdict).toBeNull();
    expect(summary.gaps).toContain('sale_price');
    expect(summary.gaps).toContain('amazon_fees');
  });

  it('shows a reviewed but incomplete packet without discarding existing sources', () => {
    const summary = summarizeCandidateEvidence([
      row('keyword_metrics', { monthlySearchVolume: 311 }),
      row('analysis_verdict', { total: 50, verdict: 'Needs Review', reasons: ['Margin is provisional without supplier-verified landed cost'] }),
      row('economics', { salePrice: null, amazonFees: null, economicsSource: 'estimated_assumption' })
    ]);
    expect(summary.status).toBe('missing_required');
    expect(summary.collectedKinds).toContain('keyword_metrics');
    expect(summary.analysisScore).toBe(50);
    expect(summary.salePrice).toBeNull();
    expect(summary.reasons).toHaveLength(1);
  });

  it('keeps latest records authoritative rather than reviving old successful evidence', () => {
    const summary = summarizeCandidateEvidence([
      row('keyword_metrics', { monthlySearchVolume: 999 }, '2026-09-01T00:00:00Z'),
      row('keyword_metrics', { monthlySearchVolume: null }, '2026-09-04T00:00:00Z')
    ]);
    expect(summary.monthlySearchVolume).toBeNull();
  });

  it('keeps verified values distinct from newer estimated placeholders', () => {
    const summary = summarizeCandidateEvidence([
      row('economics_verified', { salePrice: 29.99, amazonFees: 10.33, economicsSource: 'supplier_verified' }),
      row('economics', { salePrice: null, amazonFees: null, economicsSource: 'estimated_assumption' }, '2026-09-05T00:00:00Z')
    ]);
    expect(summary.salePrice).toBe(29.99);
    expect(summary.amazonFees).toBe(10.33);
    expect(summary.economicsSource).toBe('supplier_verified');
    expect(summary.status).not.toBe('reviewable');
  });

  it('compares actual instants rather than lexical timezone strings', () => {
    const summary = summarizeCandidateEvidence([
      row('keyword_metrics', { monthlySearchVolume: 999 }, '2026-09-04T12:00:00+02:00'),
      row('keyword_metrics', { monthlySearchVolume: 311 }, '2026-09-04T11:00:00Z')
    ]);
    expect(summary.monthlySearchVolume).toBe(311);
  });

  it('retains a verification gap when only estimated economics are present', () => {
    const summary = summarizeCandidateEvidence([
      row('economics', { salePrice: 29.99, amazonFees: 10.33, economicsSource: 'estimated_assumption' }),
      row('review_text', { notes: 'Review observations' }),
      row('analysis_verdict', { total: 80, verdict: 'Watch', reasons: [] })
    ]);
    expect(summary.status).toBe('missing_required');
    expect(summary.gaps).toContain('verified_economics');
  });

  it('does not turn a strong-potential analysis into final purchase approval', () => {
    const summary = summarizeCandidateEvidence([
      row('keyword_metrics', { monthlySearchVolume: 311 }),
      row('economics_verified', { salePrice: 29.99, amazonFees: 10.33, economicsSource: 'supplier_verified' }),
      row('review_text', { notes: 'Documented permitted review evidence' }),
      row('analysis_verdict', { total: 80, verdict: 'strong_potential', candidateState: 'Watch', reasons: [] })
    ]);
    expect(summary.status).toBe('reviewable');
    expect(summary.recordedVerdict).toBe('strong_potential');
    expect(summary.purchaseApproved).toBe(false);
  });

  it('does not treat malformed, unknown, or blank payloads as usable proof', () => {
    const summary = summarizeCandidateEvidence([
      row('keyword_metrics', { monthlySearchVolume: '311' }),
      row('analysis_verdict', { total: '50', verdict: 'GO', reasons: [] }),
      row('economics_verified', { salePrice: -1, amazonFees: '10' }),
      row('review_text', {}),
      row('unrecognized_future_kind', { value: 42 })
    ]);
    expect(summary.monthlySearchVolume).toBeNull();
    expect(summary.analysisScore).toBeNull();
    expect(summary.salePrice).toBeNull();
    expect(summary.status).not.toBe('reviewable');
    expect(summary.gaps).toContain('review_text');
  });
});
