import { randomInt } from 'node:crypto';

const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_MAX_ATTEMPTS = 32;
const PRIVATE_PORT_START = 49_152;
const PRIVATE_PORT_END = 65_536;

// WHATWG Fetch Standard §2.9, https://fetch.spec.whatwg.org/#port-blocking.
const FETCH_FORBIDDEN_PORTS = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77,
  79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135,
  137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531,
  532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719,
  1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666,
  6667, 6668, 6669, 6679, 6697, 10080,
]);

export function isFetchForbiddenPort(port) {
  return FETCH_FORBIDDEN_PORTS.has(port);
}

function defaultCandidates(maxAttempts) {
  return Array.from(
    { length: maxAttempts },
    () => randomInt(PRIVATE_PORT_START, PRIVATE_PORT_END),
  );
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    server.once('listening', onListening);
    server.once('error', onError);
    try {
      server.listen(port, LOOPBACK_HOST);
    } catch (error) {
      server.off('listening', onListening);
      server.off('error', onError);
      reject(error);
    }
  });
}

function isAddressInUse(error) {
  return typeof error === 'object' && error !== null && error.code === 'EADDRINUSE';
}

export async function listenOnFetchSafeLoopback(server, options = {}) {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError('Safe loopback maxAttempts must be a positive integer.');
  }
  const candidates = options.candidates ?? defaultCandidates(maxAttempts);
  let iterator;
  let nextMethod;
  let attempts = 0;
  let completed = false;
  let result;
  let primaryError;

  try {
    iterator = candidates[Symbol.iterator]();
    if (iterator === null || (typeof iterator !== 'object' && typeof iterator !== 'function')) {
      throw new TypeError('Safe loopback candidates iterator must be an object.');
    }
    nextMethod = iterator.next;
    if (typeof nextMethod !== 'function') {
      throw new TypeError('Safe loopback candidates iterator next must be callable.');
    }
    while (attempts < maxAttempts) {
      const next = nextMethod.call(iterator);
      if (next === null || (typeof next !== 'object' && typeof next !== 'function')) {
        throw new TypeError('Safe loopback candidates iterator result must be an object.');
      }
      if (next.done) {
        completed = true;
        break;
      }
      const port = next.value;
      attempts += 1;
      if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new RangeError(`Invalid safe loopback port candidate: ${port}.`);
      }
      if (isFetchForbiddenPort(port)) continue;
      try {
        await listen(server, port);
      } catch (error) {
        if (isAddressInUse(error)) continue;
        throw error;
      }
      const address = server.address();
      if (
        !address
        || typeof address === 'string'
        || address.address !== LOOPBACK_HOST
        || !Number.isInteger(address.port)
        || address.port < 0
        || address.port > 65_535
        || isFetchForbiddenPort(address.port)
        || address.port !== port
      ) {
        throw new Error('Safe loopback server did not bind the requested Fetch-safe IPv4 endpoint.');
      }
      result = {
        host: LOOPBACK_HOST,
        port: address.port,
        url: `http://${LOOPBACK_HOST}:${address.port}`,
      };
      break;
    }
    if (result === undefined) {
      throw new Error(`Allocation exhausted ${attempts} safe loopback port candidates.`);
    }
  } catch (error) {
    primaryError = error;
  }

  let finalizationError;
  if (!completed && iterator !== undefined
    && iterator !== null
    && (typeof iterator === 'object' || typeof iterator === 'function')) {
    try {
      const returnMethod = iterator.return;
      if (returnMethod !== undefined) {
        if (typeof returnMethod !== 'function') {
          throw new TypeError('Safe loopback candidates iterator return must be callable.');
        }
        const returnResult = returnMethod.call(iterator);
        if (returnResult === null
          || (typeof returnResult !== 'object' && typeof returnResult !== 'function')) {
          throw new TypeError('Safe loopback candidates iterator return result must be an object.');
        }
      }
    } catch (error) {
      finalizationError = error;
    }
  }
  if (primaryError && finalizationError) {
    throw new AggregateError(
      [primaryError, finalizationError],
      'Safe loopback allocation and candidate finalization both failed.',
    );
  }
  if (primaryError) throw primaryError;
  if (finalizationError) throw finalizationError;
  return result;
}
