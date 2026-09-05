import { describe, expect, it } from 'vitest';
import { chicagoBusinessDate } from './budgeted-api-call';

describe('chicagoBusinessDate', () => {
  it('uses the Chicago calendar date instead of UTC near midnight', () => {
    expect(chicagoBusinessDate(new Date('2026-09-05T04:30:00.000Z'))).toBe('2026-09-04');
    expect(chicagoBusinessDate(new Date('2026-09-05T05:30:00.000Z'))).toBe('2026-09-05');
  });

  it('rejects an invalid date', () => {
    expect(() => chicagoBusinessDate(new Date(Number.NaN))).toThrow('invalid Date');
  });
});
