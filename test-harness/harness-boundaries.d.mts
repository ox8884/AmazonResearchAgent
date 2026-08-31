import type postgres from 'postgres';
import type { ChildProcess } from 'node:child_process';
import type { EventEmitter } from 'node:events';

export const GLOBAL_DDL_LOCK: number;
export const INTEGRATION_TEST_GLOBS: readonly string[];

export function assertRunId(value: unknown): string;
export function assertDatabaseIdentifier(value: unknown): string;
export function quoteDatabaseIdentifier(value: unknown): string;
export function runOwnedDatabasePrefix(runId: unknown): string;
export function isRunOwnedDatabase(databaseName: unknown, runId: unknown): boolean;
export function assertRunOwnedDatabase(databaseName: unknown, runId: unknown): string;
export function withGlobalDdlLock<T>(admin: postgres.Sql, action: () => Promise<T>): Promise<T>;
export function createDatabase(admin: postgres.Sql, databaseName: unknown, templateDatabase?: unknown): Promise<void>;
export function markDatabaseAsTemplate(admin: postgres.Sql, databaseName: unknown): Promise<void>;
export function dropDatabase(admin: postgres.Sql, databaseName: unknown): Promise<void>;
export function cleanupRunDatabases(admin: postgres.Sql, runId: unknown): Promise<void>;
export function createIdempotentTeardown(
  stages: readonly (readonly [name: string, stage: () => Promise<void>])[],
): (originalError?: unknown) => Promise<void>;
export function assertContainerName(value: unknown): string;
export function removeDockerContainer(containerName: unknown): void;
export function installSignalForwarding(
  signalSource: EventEmitter,
  getChild: () => ChildProcess | undefined,
  onSignal?: (signal: 'SIGINT' | 'SIGTERM') => void,
): () => void;
export function childExitCode(
  code: number | null,
  signal: NodeJS.Signals | null,
  cancellationSignal: NodeJS.Signals | undefined,
): number;
export function runWithCleanup<T>(action: () => Promise<T>, cleanup: () => Promise<void>): Promise<T>;
export function isIntegrationTestPath(file: string): boolean;
