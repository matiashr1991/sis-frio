import { EventEmitter } from 'node:events';

export interface ReadingEvent {
  site: string;
  cam: string;
  temp: number;
  ts: number;
}

export interface StatusEvent {
  site: string;
  status: 'online' | 'offline';
  ts: number;
}

export interface StaleEvent {
  site: string;
  cam: string;
  stale: boolean;
  lastTs: number;
}

const camKey = (site: string, cam: string): string => `${site}/${cam}`;

/**
 * In-process event bus + liveness state.
 *
 * Owns only the `lastTs` map needed to derive staleness — current values and
 * site status live in SQLite (`store/db.ts`) and are read from there by the
 * HTTP layer. Ingest and the stale ticker are the only writers.
 */
export class Hub extends EventEmitter {
  private readonly lastTs = new Map<string, number>();
  private readonly staleCams = new Set<string>();

  constructor() {
    super();
    // Every connected SSE client adds three listeners; this is not a leak.
    this.setMaxListeners(0);
  }

  /** Seed liveness state from `store.getMaxTsPerCam()` at boot. */
  seed(rows: Array<{ site: string; cam: string; ts: number }>): void {
    for (const row of rows) {
      this.lastTs.set(camKey(row.site, row.cam), row.ts);
    }
  }

  recordReading(site: string, cam: string, temp: number, ts: number): void {
    const key = camKey(site, cam);
    this.lastTs.set(key, ts);

    const event: ReadingEvent = { site, cam, temp, ts };
    this.emit('reading', event);

    if (this.staleCams.has(key)) {
      this.staleCams.delete(key);
      const staleEvent: StaleEvent = { site, cam, stale: false, lastTs: ts };
      this.emit('stale', staleEvent);
    }
  }

  recordStatus(site: string, status: 'online' | 'offline', ts: number): void {
    const event: StatusEvent = { site, status, ts };
    this.emit('status', event);
  }

  /** Runs on every stale-ticker tick; emits one `stale:true` event per new transition. */
  tick(now: number, staleAfterMs: number): StaleEvent[] {
    const transitions: StaleEvent[] = [];

    for (const [key, ts] of this.lastTs) {
      const isStaleNow = now - ts > staleAfterMs;
      const wasStale = this.staleCams.has(key);
      if (isStaleNow && !wasStale) {
        this.staleCams.add(key);
        const separatorIndex = key.indexOf('/');
        const site = key.slice(0, separatorIndex);
        const cam = key.slice(separatorIndex + 1);
        const event: StaleEvent = { site, cam, stale: true, lastTs: ts };
        transitions.push(event);
        this.emit('stale', event);
      }
    }

    return transitions;
  }

  isStale(site: string, cam: string): boolean {
    return this.staleCams.has(camKey(site, cam));
  }

  getLastTs(site: string, cam: string): number | undefined {
    return this.lastTs.get(camKey(site, cam));
  }
}

export function createHub(): Hub {
  return new Hub();
}
