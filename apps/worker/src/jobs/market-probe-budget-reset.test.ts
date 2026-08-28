import { describe, expect, it } from 'vitest';
import { nextBudgetResetAt } from './market-probe';

describe('nextBudgetResetAt', () => {
  it('does not resume before the next America/Chicago budget day', () => {
    const winter = new Date('2026-01-15T22:30:00.000Z');
    const reset = new Date(nextBudgetResetAt(winter));
    expect(reset.getTime()).toBeGreaterThan(winter.getTime());
    const chicagoDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago'
    }).format(reset);
    expect(chicagoDate).toBe('2026-01-16');
  });

  it('uses America/Chicago rather than earlier UTC midnight during CDT', () => {
    const summerEveningUtc = new Date('2026-07-15T05:30:00.000Z');
    const reset = new Date(nextBudgetResetAt(summerEveningUtc));
    const utcMidnight = Date.UTC(2026, 6, 16, 0, 0, 0);
    expect(reset.getTime()).toBeGreaterThanOrEqual(utcMidnight);
    const chicagoDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago'
    }).format(reset);
    expect(chicagoDate).toBe('2026-07-16');
  });
});
