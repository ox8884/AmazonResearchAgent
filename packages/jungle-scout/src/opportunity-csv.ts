import { parse } from 'csv-parse/sync';
import {
  OpportunityCsvRowSchema,
  type OpportunityCsvRow
} from '@ara/shared';

export const REQUIRED_OPPORTUNITY_HEADERS = [
  'Keyword',
  'Niche Score',
  'Units Sold - Monthly Avg',
  'Price - Monthly Avg',
  'Search Volume - 30 Day Exact',
  'Search Trend - 30 Day',
  'Search Trend - 90 Day',
  'Competition',
  'Seasonality',
  'Last Updated'
] as const;

type RequiredHeader = (typeof REQUIRED_OPPORTUNITY_HEADERS)[number];
type RawOpportunityRecord = Record<string, string>;

interface CsvRecordInfo {
  lines: number;
}

interface CsvRecordWithInfo {
  record: RawOpportunityRecord;
  raw: string;
  info: CsvRecordInfo;
}

export interface ParsedOpportunityRow extends OpportunityCsvRow {
  sourceFileName: string;
  sourceRowNumber: number;
  rawRowText: string;
  rawRow: RawOpportunityRecord;
}

export interface ParsedOpportunityFile {
  sourceFileName: string;
  headers: string[];
  rows: ParsedOpportunityRow[];
}

export class OpportunityCsvParseError extends Error {
  constructor(
    message: string,
    readonly sourceFileName: string,
    readonly sourceRowNumber?: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'OpportunityCsvParseError';
  }
}

function requiredValue(
  record: RawOpportunityRecord,
  header: RequiredHeader,
  sourceFileName: string,
  sourceRowNumber: number
): string {
  const value = record[header];
  if (value === undefined || value.trim() === '') {
    throw new OpportunityCsvParseError(
      `${sourceFileName} row ${sourceRowNumber}: ${header} is required`,
      sourceFileName,
      sourceRowNumber
    );
  }
  return value.trim();
}

function parseNumber(
  value: string,
  field: string,
  sourceFileName: string,
  sourceRowNumber: number
): number {
  const normalized = value.replaceAll(',', '').replace(/^\$/, '').replace(/%$/, '').trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new OpportunityCsvParseError(
      `${sourceFileName} row ${sourceRowNumber}: ${field} must be numeric`,
      sourceFileName,
      sourceRowNumber
    );
  }
  return parsed;
}

function parseSearchVolume(
  value: string,
  sourceFileName: string,
  sourceRowNumber: number
): { value: number; isUpperBound: boolean } {
  const upperBound = /^<\s*(.+)$/.exec(value);
  const numeric = parseNumber(
    upperBound?.[1] ?? value,
    'Search Volume - 30 Day Exact',
    sourceFileName,
    sourceRowNumber
  );
  return { value: numeric, isUpperBound: Boolean(upperBound) };
}

function startingLine(info: CsvRecordInfo, raw: string): number {
  const lineBreaks = raw.match(/\r\n|\n|\r/g)?.length ?? 0;
  const trailingDelimiter = /(?:\r\n|\n|\r)$/.test(raw) ? 1 : 0;
  return info.lines - Math.max(0, lineBreaks - trailingDelimiter);
}

function mapRow(
  entry: CsvRecordWithInfo,
  sourceFileName: string
): ParsedOpportunityRow {
  const sourceRowNumber = startingLine(entry.info, entry.raw);
  const value = (header: RequiredHeader): string =>
    requiredValue(entry.record, header, sourceFileName, sourceRowNumber);

  try {
    const parsed = OpportunityCsvRowSchema.parse({
      keyword: value('Keyword'),
      nicheScore: parseNumber(
        value('Niche Score'),
        'Niche Score',
        sourceFileName,
        sourceRowNumber
      ),
      monthlyUnits: parseNumber(
        value('Units Sold - Monthly Avg'),
        'Units Sold - Monthly Avg',
        sourceFileName,
        sourceRowNumber
      ),
      averagePrice: parseNumber(
        value('Price - Monthly Avg'),
        'Price - Monthly Avg',
        sourceFileName,
        sourceRowNumber
      ),
      searchVolume: parseSearchVolume(
        value('Search Volume - 30 Day Exact'),
        sourceFileName,
        sourceRowNumber
      ),
      trend30: parseNumber(
        value('Search Trend - 30 Day'),
        'Search Trend - 30 Day',
        sourceFileName,
        sourceRowNumber
      ),
      trend90: parseNumber(
        value('Search Trend - 90 Day'),
        'Search Trend - 90 Day',
        sourceFileName,
        sourceRowNumber
      ),
      competition: value('Competition'),
      seasonality: value('Seasonality'),
      lastUpdated: value('Last Updated')
    });

    return {
      ...parsed,
      sourceFileName,
      sourceRowNumber,
      rawRowText: entry.raw,
      rawRow: { ...entry.record }
    };
  } catch (error) {
    if (error instanceof OpportunityCsvParseError) {
      throw error;
    }
    throw new OpportunityCsvParseError(
      `${sourceFileName} row ${sourceRowNumber}: invalid Opportunity Finder row`,
      sourceFileName,
      sourceRowNumber,
      { cause: error }
    );
  }
}

export function parseOpportunityFinderCsv(
  input: string,
  sourceFileName: string
): ParsedOpportunityFile {
  if (sourceFileName.trim() === '') {
    throw new OpportunityCsvParseError(
      'sourceFileName must not be empty',
      sourceFileName
    );
  }

  let headers: string[] = [];
  try {
    const entries = parse(input, {
      bom: true,
      columns(rawHeaders: string[]) {
        headers = rawHeaders.map((header) => header.trim());
        const missing = REQUIRED_OPPORTUNITY_HEADERS.filter(
          (required) => !headers.includes(required)
        );
        if (missing.length > 0) {
          throw new OpportunityCsvParseError(
            `Missing required Opportunity Finder headers: ${missing.join(', ')}`,
            sourceFileName
          );
        }
        return headers;
      },
      info: true,
      raw: true,
      relax_column_count: false,
      skip_empty_lines: true,
      trim: false
    }) as CsvRecordWithInfo[];

    if (headers.length === 0) {
      throw new OpportunityCsvParseError(
        `Missing required Opportunity Finder headers: ${REQUIRED_OPPORTUNITY_HEADERS.join(', ')}`,
        sourceFileName
      );
    }

    return {
      sourceFileName,
      headers,
      rows: entries.map((entry) => mapRow(entry, sourceFileName))
    };
  } catch (error) {
    if (error instanceof OpportunityCsvParseError) {
      throw error;
    }
    throw new OpportunityCsvParseError(
      `${sourceFileName}: invalid CSV structure`,
      sourceFileName,
      undefined,
      { cause: error }
    );
  }
}
