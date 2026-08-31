import type { Server } from 'node:http';

export interface SafeLoopbackAddress {
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly url: string;
}

export interface SafeLoopbackOptions {
  readonly candidates?: Iterable<number>;
  readonly maxAttempts?: number;
}

export function isFetchForbiddenPort(port: number): boolean;
export function listenOnFetchSafeLoopback(
  server: Server,
  options?: SafeLoopbackOptions,
): Promise<SafeLoopbackAddress>;
