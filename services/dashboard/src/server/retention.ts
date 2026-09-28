import type { Store } from './store/db.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function purgeExpired(store: Store, retentionDays: number, now: number = Date.now()): number {
  const cutoff = now - retentionDays * DAY_MS;
  return store.purgeOlderThan(cutoff);
}

function runPurge(store: Store, retentionDays: number): void {
  try {
    purgeExpired(store, retentionDays);
  } catch (err) {
    console.error('retention purge failed, will retry next tick:', err instanceof Error ? err.message : err);
  }
}

/** Purges once immediately, then hourly. Returns a stop function. */
export function startRetentionJob(store: Store, retentionDays: number): () => void {
  runPurge(store, retentionDays);

  const timer = setInterval(() => runPurge(store, retentionDays), HOUR_MS);
  timer.unref();

  return () => clearInterval(timer);
}
