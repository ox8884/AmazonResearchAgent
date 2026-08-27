import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  OpportunityCsvParseError,
  parseOpportunityFinderCsv
} from './opportunity-csv';

const pageOnePath = fileURLToPath(
  new URL('../../../tests/fixtures/opportunity-finder/page-1.csv', import.meta.url)
);
const pageTwoPath = fileURLToPath(
  new URL('../../../tests/fixtures/opportunity-finder/page-2.csv', import.meta.url)
);
const PAGE_ONE = readFileSync(pageOnePath, 'utf8');
const PAGE_TWO = readFileSync(pageTwoPath, 'utf8');

describe('Opportunity Finder CSV parser', () => {
  // Break: currency, thousands separators, percentages, or < bounds lose meaning.
  it('parses formatted numeric fields without losing upper-bound meaning', () => {
    const parsed = parseOpportunityFinderCsv(PAGE_ONE, 'page-1.csv');
    const first = parsed.rows[0];

    expect(first).toMatchObject({
      averagePrice: 23.98,
      monthlyUnits: 5038,
      searchVolume: { value: 450, isUpperBound: true },
      trend30: 8,
      trend90: -37
    });
  });

  // Break: quoted commas split one source row into multiple records.
  it('parses quoted keywords and preserves source row evidence', () => {
    const parsed = parseOpportunityFinderCsv(PAGE_ONE, 'page-1.csv');
    const row = parsed.rows[2];

    expect(row?.keyword).toBe('utensil holder, compact');
    expect(row?.sourceRowNumber).toBe(4);
    expect(row?.rawRow['Keyword']).toBe('utensil holder, compact');
    expect(row?.rawRowText).toContain('"utensil holder, compact"');
  });

  // Break: a second page is parsed with a different schema or loses exact volume.
  it('parses multiple page fixtures with the same strict contract', () => {
    const pageOne = parseOpportunityFinderCsv(PAGE_ONE, 'page-1.csv');
    const pageTwo = parseOpportunityFinderCsv(PAGE_TWO, 'page-2.csv');

    expect(pageOne.rows).toHaveLength(4);
    expect(pageTwo.rows).toHaveLength(4);
    expect(pageTwo.rows[2]?.searchVolume).toEqual({
      value: 4800,
      isUpperBound: false
    });
  });

  // Break: a malformed export silently maps a missing required column to zero.
  it('rejects files missing a required header', () => {
    const malformed = 'Keyword,Niche Score\npancake dispenser bottle,9\n';

    expect(() =>
      parseOpportunityFinderCsv(malformed, 'malformed.csv')
    ).toThrowError(OpportunityCsvParseError);
    expect(() =>
      parseOpportunityFinderCsv(malformed, 'malformed.csv')
    ).toThrow('Missing required Opportunity Finder headers');
  });

  // Break: malformed values are coerced to NaN and persisted as valid rows.
  it('reports the source row for invalid numeric data', () => {
    const malformed = PAGE_ONE.replace('"5,038"', 'not-a-number');

    expect(() =>
      parseOpportunityFinderCsv(malformed, 'bad-number.csv')
    ).toThrow('bad-number.csv row 2');
  });
});
