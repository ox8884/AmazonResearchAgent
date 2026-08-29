import { describe, expect, it } from 'vitest';
import { renderDailyDigest } from './digest';

function makeDigestFixture() {
  return {
    events: [
      { type: 'DAILY_SUMMARY', summary: '2 Watch, 0 Strong' },
      { type: 'NEW_STRONG', summary: 'sink mat' },
      { type: 'heartbeat', summary: 'heartbeat' },
      { type: 'cache_hit', summary: 'cache hit' }
    ]
  };
}

describe('daily digest renderer', () => {
  it('renders Korean digest by default and omits trivial events', () => {
    const text = renderDailyDigest(makeDigestFixture(), 'ko');
    expect(text).toContain('오늘의 리서치 요약');
    expect(text).not.toContain('heartbeat');
    expect(text).toContain('sink mat');
  });

  it('renders an English digest when requested', () => {
    const text = renderDailyDigest(makeDigestFixture(), 'en');
    expect(text).toContain('Today’s research summary');
    expect(text).not.toContain('cache hit');
  });
});
