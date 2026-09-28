import type { Hub } from './hub.js';

const TICK_INTERVAL_MS = 5000;

/**
 * Starts the 5s staleness ticker. Returns a stop function.
 * Worst-case detection latency is `staleAfterMs + TICK_INTERVAL_MS`
 * (~35s for the default 30s threshold), per design.md.
 */
export function startStaleTicker(hub: Hub, staleAfterMs: number): () => void {
  const timer = setInterval(() => {
    hub.tick(Date.now(), staleAfterMs);
  }, TICK_INTERVAL_MS);
  timer.unref();

  return () => clearInterval(timer);
}
