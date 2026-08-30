import { describe, expect, it } from 'vitest';
import { renderDailyDigest, type DailyDigestSnapshot } from './digest';

function makeDigestFixture() {
  return {
    events: [
      { type: 'DAILY_SUMMARY', summary: 'research run 00000000-0000-4000-8000-0000000000aa' },
      { type: 'NEW_STRONG', summary: 'sink mat' },
      { type: 'heartbeat', summary: 'heartbeat' },
      { type: 'cache_hit', summary: 'cache hit' }
    ]
  };
}

function richSnapshot(overrides: Partial<DailyDigestSnapshot> = {}): DailyDigestSnapshot {
  return {
    logicalRunDate: '2026-08-29',
    importedKeywords: 184,
    normalizedNiches: 37,
    candidatesEvaluated: 15,
    strong: 3,
    watch: 5,
    reject: 7,
    needsAttention: 1,
    topCandidates: [
      {
        title: 'Silicone Sink Splash Guard',
        state: 'Strong',
        score: 82,
        price: 24.99,
        monthlySales: 420,
        reviews: 286
      },
      {
        title: 'Adjustable Pot Lid Organizer',
        state: 'Strong',
        score: 78,
        price: 29.95,
        monthlySales: 310,
        reviews: 174
      },
      {
        title: 'Bamboo Drawer Organizer',
        state: 'Watch',
        score: 71
      }
    ],
    jungleScoutUsed: 15,
    jungleScoutBudget: 20,
    reservedUsed: 0,
    reservedBudget: 5,
    aiAnalyses: 37,
    runIdShort: '80a100b2',
    nextRunLabel: '내일 03:00 CT',
    ...overrides
  };
}

describe('daily digest renderer', () => {
  it('renders Korean digest by default and omits trivial events', () => {
    const text = renderDailyDigest(makeDigestFixture(), 'ko');
    expect(text).toContain('오늘의');
    expect(text).not.toContain('heartbeat');
    expect(text).toContain('sink mat');
  });

  it('renders an English digest when requested', () => {
    const text = renderDailyDigest(makeDigestFixture(), 'en');
    expect(text).toContain('research summary');
    expect(text).not.toContain('cache hit');
  });

  it('renders a Korean candidate-rich summary with top 3 and usage', () => {
    const text = renderDailyDigest(
      { events: [{ type: 'DAILY_SUMMARY', summary: 'research run aabbccdd-eeee-ffff-0000-111111111111' }], snapshot: richSnapshot() },
      'ko'
    );
    expect(text).toContain('오늘의 Amazon 리서치 요약');
    expect(text).toContain('2026-08-29');
    expect(text).toContain('수집 키워드: 184개');
    expect(text).toContain('정규화 니치: 37개');
    expect(text).toContain('Strong: 3개');
    expect(text).toContain('Watch: 5개');
    expect(text).toContain('Reject: 7개');
    expect(text).toContain('Silicone Sink Splash Guard');
    expect(text).toContain('Adjustable Pot Lid Organizer');
    expect(text).toContain('Bamboo Drawer Organizer');
    expect(text).toContain('가격: $24.99');
    expect(text).toContain('월 판매량: 420');
    expect(text).toContain('리뷰: 286');
    expect(text).toContain('종합 점수: 82/100');
    expect(text).toContain('Jungle Scout: 15 / 20');
    expect(text).toContain('Reserved: 0 / 5');
    expect(text).toContain('AI 분석: 37');
    expect(text).toContain('Needs Attention: 1개');
    expect(text).toContain('다음 자동 리서치: 내일 03:00 CT');
    expect(text).toContain('Run: 80a100b2');
    expect(text).not.toContain('aabbccdd-eeee-ffff-0000-111111111111');
  });

  it('renders a clear empty-day Korean summary without a UUID body', () => {
    const text = renderDailyDigest(
      {
        events: [{ type: 'DAILY_SUMMARY', summary: 'research run 00000000-0000-4000-8000-0000000000aa' }],
        snapshot: richSnapshot({
          importedKeywords: 0,
          normalizedNiches: 0,
          candidatesEvaluated: 0,
          strong: 0,
          watch: 0,
          reject: 0,
          needsAttention: 0,
          topCandidates: [],
          jungleScoutUsed: 0,
          reservedUsed: 0,
          aiAnalyses: 0
        })
      },
      'ko'
    );
    expect(text).toContain('오늘 조건을 만족한 후보가 없습니다');
    expect(text).toContain('수집 키워드: 0개');
    expect(text).toContain('Strong: 0개');
    expect(text).toContain('Jungle Scout: 0 / 20');
    expect(text).not.toMatch(/research run [0-9a-f-]{36}/u);
  });

  it('omits missing optional metrics instead of printing null', () => {
    const text = renderDailyDigest(
      {
        events: [],
        snapshot: {
          logicalRunDate: '2026-08-29',
          importedKeywords: 184,
          candidatesEvaluated: 15,
          strong: 3,
          watch: 5,
          reject: 7,
          needsAttention: 1,
          topCandidates: [{ title: 'Plain Niche', state: 'Watch', score: 61 }],
          jungleScoutUsed: 15,
          jungleScoutBudget: 20,
          runIdShort: '80a100b2',
          nextRunLabel: '내일 03:00 CT'
        }
      },
      'ko'
    );
    expect(text).toContain('Plain Niche');
    expect(text).toContain('상태: Watch');
    expect(text).toContain('종합 점수: 61/100');
    expect(text).not.toContain('가격:');
    expect(text).not.toContain('월 판매량:');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('정규화 니치:');
    expect(text).not.toContain('Reserved:');
    expect(text).not.toContain('AI 분석:');
  });

  it('includes Needs Attention in the attention section', () => {
    const text = renderDailyDigest({ events: [], snapshot: richSnapshot({ needsAttention: 2 }) }, 'ko');
    expect(text).toContain('확인 필요');
    expect(text).toContain('Needs Attention: 2개');
  });

  it('renders an English rich summary', () => {
    const text = renderDailyDigest({ events: [], snapshot: richSnapshot() }, 'en');
    expect(text).toContain('Amazon research summary');
    expect(text).toContain('Silicone Sink Splash Guard');
    expect(text).toContain('Jungle Scout: 15 / 20');
    expect(text).not.toContain('오늘의');
  });

  it('keeps punctuation in titles as plain text', () => {
    const text = renderDailyDigest(
      {
        events: [],
        snapshot: richSnapshot({
          topCandidates: [{ title: 'Sink Mat (12" x 18") *Set of 2*', state: 'Strong', score: 80 }]
        })
      },
      'ko'
    );
    expect(text).toContain('Sink Mat (12" x 18") *Set of 2*');
  });
});
