#!/usr/bin/env node

export function subscriptionGcDecision(activeState, ageMinutes) {
  if (!Number.isFinite(ageMinutes) || ageMinutes < 0) throw new TypeError('Invalid invocation age.');
  if (!['active', 'activating', 'deactivating', 'inactive', 'failed', 'unknown'].includes(activeState)) {
    throw new TypeError('Invalid unit state.');
  }
  return (activeState === 'inactive' || activeState === 'failed') && ageMinutes > 10
    ? 'remove'
    : 'retain';
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href) {
  const age = Number(process.argv[3]);
  process.stdout.write(`${subscriptionGcDecision(process.argv[2] ?? '', age)}\n`);
}
