import { createHash } from 'node:crypto';
import type { Database, Json } from '@ara/db';
import {
  parseOpportunityFinderCsv,
  type ParsedOpportunityRow
} from '@ara/jungle-scout';
import type { QueueDatabaseClient } from '@ara/queue';
import {
  DEFAULT_RULES,
  evaluateOpportunityRules,
  scorePreliminaryOpportunity,
  type PreliminaryScore,
  type RuleEvaluation
} from '@ara/research-engine';

export type ImportPhase =
  | 'parsed'
  | 'persisted_raw'
  | 'filtered'
  | 'scored'
  | 'completed';

export interface ImportCheckpoint {
  phase: ImportPhase;
  importRunId: string;
  processedKeywordCount: number;
}

export interface ImportSourceFile {
  sourceFileName: string;
  content: string;
}

export interface ImportJobInput {
  importRunId: string;
  files: ImportSourceFile[];
}

export interface ImportJobDependencies {
  client: QueueDatabaseClient;
  onCheckpoint?(checkpoint: ImportCheckpoint): Promise<void>;
}

export interface ImportJobResult {
  importRunId: string;
  fileCount: number;
  totalRowCount: number;
  uniqueKeywordCount: number;
  duplicateKeywordCount: number;
  rejectedCount: number;
  acceptedCount: number;
  checkpoint: ImportCheckpoint;
}

interface WorkingRow {
  parsed: ParsedOpportunityRow;
  sourceHash: string;
  rowHash: string;
  normalizedExactKeyword: string;
  rawId: string;
  duplicateOf: string | null;
}

interface EvaluatedCandidate {
  row: WorkingRow;
  candidateId: string;
  evaluation: RuleEvaluation;
  score: PreliminaryScore;
}

type RawKeywordInsert =
  Database['public']['Tables']['raw_opportunity_keywords']['Insert'];
type CandidateInsert = Database['public']['Tables']['candidates']['Insert'];
type DecisionInsert =
  Database['public']['Tables']['decision_history']['Insert'];
type ScoreInsert = Database['public']['Tables']['score_history']['Insert'];
type AuditInsert = Database['public']['Tables']['audit_events']['Insert'];

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(sha256(seed).slice(0, 32), 'hex');
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join('-');
}

function normalizeExactKeyword(keyword: string): string {
  return keyword
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .trim()
    .replace(/\s+/g, ' ');
}

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown import error';
  return message
    .replace(/\bsb_secret_[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .slice(0, 8000);
}

function parsedRowEvidence(row: ParsedOpportunityRow): Json {
  return asJson({
    keyword: row.keyword,
    nicheScore: row.nicheScore,
    monthlyUnits: row.monthlyUnits,
    averagePrice: row.averagePrice,
    searchVolume: row.searchVolume,
    trend30: row.trend30,
    trend90: row.trend90,
    competition: row.competition,
    seasonality: row.seasonality,
    lastUpdated: row.lastUpdated
  });
}

async function checkpoint(
  dependencies: ImportJobDependencies,
  value: ImportCheckpoint
): Promise<ImportCheckpoint> {
  await dependencies.onCheckpoint?.(value);
  return value;
}

function requireFiles(files: ImportSourceFile[]): void {
  if (files.length === 0) {
    throw new TypeError('At least one Opportunity Finder CSV file is required');
  }
  const names = new Set<string>();
  for (const file of files) {
    if (file.sourceFileName.trim() === '') {
      throw new TypeError('sourceFileName must not be empty');
    }
    if (names.has(file.sourceFileName)) {
      throw new TypeError(`Duplicate source file name: ${file.sourceFileName}`);
    }
    names.add(file.sourceFileName);
  }
}

function prepareRows(importRunId: string, files: ImportSourceFile[]): WorkingRow[] {
  const rows: WorkingRow[] = [];
  const representativeByKeyword = new Map<string, string>();

  for (const file of files) {
    const sourceHash = sha256(`${file.sourceFileName}\0${file.content}`);
    const parsedFile = parseOpportunityFinderCsv(file.content, file.sourceFileName);
    for (const parsed of parsedFile.rows) {
      const normalizedExactKeyword = normalizeExactKeyword(parsed.keyword);
      const rowHash = sha256(
        `${sourceHash}\0${parsed.sourceRowNumber}\0${parsed.rawRowText}`
      );
      const rawId = deterministicUuid(
        `raw:${importRunId}:${sourceHash}:${parsed.sourceRowNumber}`
      );
      const duplicateOf = representativeByKeyword.get(normalizedExactKeyword) ?? null;
      if (!duplicateOf) {
        representativeByKeyword.set(normalizedExactKeyword, rawId);
      }
      rows.push({
        parsed,
        sourceHash,
        rowHash,
        normalizedExactKeyword,
        rawId,
        duplicateOf
      });
    }
  }
  return rows;
}

function rawInserts(importRunId: string, rows: WorkingRow[]): RawKeywordInsert[] {
  return rows.map((row) => ({
    id: row.rawId,
    import_run_id: importRunId,
    source_file_name: row.parsed.sourceFileName,
    source_hash: row.sourceHash,
    source_row_number: row.parsed.sourceRowNumber,
    row_hash: row.rowHash,
    raw_row_text: row.parsed.rawRowText,
    raw_row: asJson(row.parsed.rawRow),
    parsed_row: parsedRowEvidence(row.parsed),
    keyword: row.parsed.keyword,
    normalized_exact_keyword: row.normalizedExactKeyword,
    is_exact_duplicate: row.duplicateOf !== null,
    duplicate_of: row.duplicateOf
  }));
}

function evaluateRows(importRunId: string, rows: WorkingRow[]): EvaluatedCandidate[] {
  return rows
    .filter((row) => row.duplicateOf === null)
    .map((row) => {
      const evaluation = evaluateOpportunityRules(row.parsed, DEFAULT_RULES);
      return {
        row,
        candidateId: deterministicUuid(
          `candidate:${importRunId}:${row.normalizedExactKeyword}`
        ),
        evaluation,
        score: scorePreliminaryOpportunity(row.parsed, evaluation)
      };
    });
}

function candidateInserts(
  importRunId: string,
  candidates: EvaluatedCandidate[]
): CandidateInsert[] {
  return candidates.map(({ row, candidateId, evaluation, score }) => ({
    id: candidateId,
    import_run_id: importRunId,
    representative_raw_keyword_id: row.rawId,
    keyword: row.parsed.keyword,
    normalized_exact_keyword: row.normalizedExactKeyword,
    state: evaluation.passed ? 'AI Screening' : 'Reject',
    rule_passed: evaluation.passed,
    rule_reasons: asJson(evaluation.reasons),
    risk_flags: asJson(evaluation.flags),
    preliminary_score: score.score,
    preliminary_score_components: asJson(score.components),
    eligible_for_ai_normalization: score.eligibleForAiNormalization
  }));
}

function decisionInserts(
  importRunId: string,
  candidates: EvaluatedCandidate[]
): DecisionInsert[] {
  return candidates.map(({ candidateId, evaluation }) => ({
    id: deterministicUuid(`decision:${importRunId}:${candidateId}:rule-v1`),
    candidate_id: candidateId,
    from_state: 'Rule Filter',
    to_state: evaluation.passed ? 'AI Screening' : 'Reject',
    reasons: asJson(evaluation.reasons),
    decided_by: 'deterministic-rules-v1',
    idempotency_key: `import:${importRunId}:candidate:${candidateId}:rule-v1`
  }));
}

function scoreInserts(
  importRunId: string,
  candidates: EvaluatedCandidate[]
): ScoreInsert[] {
  return candidates.map(({ candidateId, score }) => ({
    id: deterministicUuid(`score:${importRunId}:${candidateId}:preliminary-v1`),
    candidate_id: candidateId,
    score_type: score.scoreType,
    score: score.score,
    components: asJson(score.components),
    idempotency_key: `import:${importRunId}:candidate:${candidateId}:preliminary-v1`
  }));
}

function auditInserts(
  importRunId: string,
  candidates: EvaluatedCandidate[]
): AuditInsert[] {
  return candidates.map(({ row, candidateId, evaluation, score }) => ({
    id: deterministicUuid(`audit:${importRunId}:${candidateId}:evaluated-v1`),
    import_run_id: importRunId,
    entity_type: 'candidate',
    entity_id: candidateId,
    event_type: 'DETERMINISTIC_EVALUATION_COMPLETED',
    actor_type: 'worker',
    metadata: asJson({
      keyword: row.parsed.keyword,
      ruleReasons: evaluation.reasons,
      riskFlags: evaluation.flags,
      preliminaryScore: score.score
    }),
    idempotency_key: `import:${importRunId}:candidate:${candidateId}:audit-v1`
  }));
}

async function assertImportRun(
  client: QueueDatabaseClient,
  input: ImportJobInput
): Promise<void> {
  const { data, error } = await client
    .from('import_runs')
    .update({
      status: 'processing',
      error_message: null,
      started_at: new Date().toISOString(),
      file_count: input.files.length,
      source_files: asJson(
        input.files.map((file) => ({ name: file.sourceFileName }))
      )
    })
    .eq('id', input.importRunId)
    .select('id')
    .single();
  if (error || !data) {
    throw error ?? new Error(`Import run not found: ${input.importRunId}`);
  }
}

export async function runImportJob(
  input: ImportJobInput,
  dependencies: ImportJobDependencies
): Promise<ImportJobResult> {
  requireFiles(input.files);
  await assertImportRun(dependencies.client, input);

  try {
    const rows = prepareRows(input.importRunId, input.files);
    await checkpoint(dependencies, {
      phase: 'parsed',
      importRunId: input.importRunId,
      processedKeywordCount: rows.length
    });

    const { error: rawError } = await dependencies.client
      .from('raw_opportunity_keywords')
      .upsert(rawInserts(input.importRunId, rows), {
        onConflict: 'import_run_id,source_hash,source_row_number'
      });
    if (rawError) {
      throw rawError;
    }
    await checkpoint(dependencies, {
      phase: 'persisted_raw',
      importRunId: input.importRunId,
      processedKeywordCount: rows.length
    });

    const candidates = evaluateRows(input.importRunId, rows);
    await checkpoint(dependencies, {
      phase: 'filtered',
      importRunId: input.importRunId,
      processedKeywordCount: candidates.length
    });
    await checkpoint(dependencies, {
      phase: 'scored',
      importRunId: input.importRunId,
      processedKeywordCount: candidates.length
    });

    const { error: candidateError } = await dependencies.client
      .from('candidates')
      .upsert(candidateInserts(input.importRunId, candidates), {
        onConflict: 'import_run_id,normalized_exact_keyword'
      });
    if (candidateError) {
      throw candidateError;
    }
    const { error: decisionError } = await dependencies.client
      .from('decision_history')
      .upsert(decisionInserts(input.importRunId, candidates), {
        onConflict: 'idempotency_key'
      });
    if (decisionError) {
      throw decisionError;
    }
    const { error: scoreError } = await dependencies.client
      .from('score_history')
      .upsert(scoreInserts(input.importRunId, candidates), {
        onConflict: 'idempotency_key'
      });
    if (scoreError) {
      throw scoreError;
    }
    const { error: auditError } = await dependencies.client
      .from('audit_events')
      .upsert(auditInserts(input.importRunId, candidates), {
        onConflict: 'idempotency_key'
      });
    if (auditError) {
      throw auditError;
    }

    const rejectedCount = candidates.filter(
      (candidate) => !candidate.evaluation.passed
    ).length;
    const acceptedCount = candidates.length - rejectedCount;
    const duplicateKeywordCount = rows.length - candidates.length;
    const completedAt = new Date().toISOString();
    const { error: runError } = await dependencies.client
      .from('import_runs')
      .update({
        status: 'completed',
        total_row_count: rows.length,
        unique_keyword_count: candidates.length,
        duplicate_keyword_count: duplicateKeywordCount,
        rejected_count: rejectedCount,
        accepted_count: acceptedCount,
        completed_at: completedAt,
        error_message: null
      })
      .eq('id', input.importRunId);
    if (runError) {
      throw runError;
    }

    const completedCheckpoint = await checkpoint(dependencies, {
      phase: 'completed',
      importRunId: input.importRunId,
      processedKeywordCount: candidates.length
    });

    return {
      importRunId: input.importRunId,
      fileCount: input.files.length,
      totalRowCount: rows.length,
      uniqueKeywordCount: candidates.length,
      duplicateKeywordCount,
      rejectedCount,
      acceptedCount,
      checkpoint: completedCheckpoint
    };
  } catch (error) {
    await dependencies.client
      .from('import_runs')
      .update({
        status: 'failed',
        error_message: safeErrorMessage(error)
      })
      .eq('id', input.importRunId);
    throw error;
  }
}
