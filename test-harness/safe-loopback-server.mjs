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
  let attempts = 0;
  for (const port of candidates) {
    if (attempts >= maxAttempts) break;
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
    if (!address || typeof address === 'string' || address.address !== LOOPBACK_HOST) {
      throw new Error('Safe loopback server did not bind the expected IPv4 address.');
    }
    return {
      host: LOOPBACK_HOST,
      port: address.port,
      url: `http://${LOOPBACK_HOST}:${address.port}`,
    };
  }
  throw new Error(`Allocation exhausted ${attempts} safe loopback port candidates.`);
}
