import { describe, expect, it } from 'vitest';
import {
  deriveChicagoDate,
  parseLogicalRunDate
} from '../jobs/daily-research';
import { requestedDailyDate } from './enqueue-daily';

describe('daily scheduler date handling', () => {
  it('derives the prior Chicago calendar date just before winter midnight', () => {
    expect(deriveChicagoDate(new Date('2026-01-15T05:59:59.000Z'))).toBe('2026-01-14');
  });

  it('derives the prior Chicago calendar date just before summer midnight', () => {
    expect(deriveChicagoDate(new Date('2026-07-15T04:59:59.000Z'))).toBe('2026-07-14');
  });

  it('uses an explicit valid date and rejects normalized calendar dates', () => {
    expect(requestedDailyDate('2026-08-27', new Date('2026-08-28T00:00:00.000Z'))).toBe('2026-08-27');
    expect(() => parseLogicalRunDate('2026-02-30')).toThrow();
  });
});
