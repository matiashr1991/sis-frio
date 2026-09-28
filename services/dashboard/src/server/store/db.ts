import DatabaseConstructor, { type Database } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface LatestReadingRow {
  site: string;
  cam: string;
  ts: number;
  temp: number;
}

export interface StatusRow {
  site: string;
  status: 'online' | 'offline';
  ts: number;
}

export interface HistoryPoint {
  bucketTs: number;
  avg: number;
  min: number;
  max: number;
}

const SCHEMA_VERSION = 1;

export class Store {
  readonly db: Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseConstructor(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.migrate();
  }

  private migrate(): void {
    const currentVersion = this.db.pragma('user_version', { simple: true }) as number;
    if (currentVersion >= SCHEMA_VERSION) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS readings (
        site TEXT NOT NULL,
        cam TEXT NOT NULL,
        ts INTEGER NOT NULL,
        temp REAL NOT NULL,
        PRIMARY KEY (site, cam, ts)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS readings_ts ON readings(ts);
      CREATE TABLE IF NOT EXISTS site_status (
        site TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('online','offline')),
        ts INTEGER NOT NULL
      );
    `);
    this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }

  insertReading(site: string, cam: string, ts: number, temp: number): void {
    this.db
      .prepare('INSERT OR IGNORE INTO readings (site, cam, ts, temp) VALUES (?, ?, ?, ?)')
      .run(site, cam, ts, temp);
  }

  upsertStatus(site: string, status: 'online' | 'offline', ts: number): void {
    this.db
      .prepare(
        `INSERT INTO site_status (site, status, ts) VALUES (?, ?, ?)
         ON CONFLICT(site) DO UPDATE SET status = excluded.status, ts = excluded.ts
         WHERE excluded.ts >= site_status.ts`,
      )
      .run(site, status, ts);
  }

  getLatestReadings(): LatestReadingRow[] {
    return this.db
      .prepare('SELECT site, cam, MAX(ts) AS ts, temp FROM readings GROUP BY site, cam')
      .all() as LatestReadingRow[];
  }

  /** Seed data for the in-memory liveness map: last-seen ts per (site, cam). */
  getMaxTsPerCam(): Array<{ site: string; cam: string; ts: number }> {
    return this.db
      .prepare('SELECT site, cam, MAX(ts) AS ts FROM readings GROUP BY site, cam')
      .all() as Array<{ site: string; cam: string; ts: number }>;
  }

  getStatuses(): StatusRow[] {
    return this.db.prepare('SELECT site, status, ts FROM site_status').all() as StatusRow[];
  }

  getHistory(
    site: string,
    cam: string,
    fromMs: number,
    toMs: number,
    bucketSeconds: number,
  ): HistoryPoint[] {
    const bucketMs = Math.round(bucketSeconds * 1000);
    // better-sqlite3 binds JS numbers as REAL by default, so the divisor must
    // be cast back to INTEGER or `/` performs floating-point division instead
    // of the truncating integer division the bucketing math depends on.
    return this.db
      .prepare(
        `SELECT (CAST(ts AS INTEGER) / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS bucketTs,
                AVG(temp) AS avg, MIN(temp) AS min, MAX(temp) AS max
         FROM readings
         WHERE site = ? AND cam = ? AND ts >= ? AND ts < ?
         GROUP BY bucketTs
         ORDER BY bucketTs ASC`,
      )
      .all(bucketMs, bucketMs, site, cam, fromMs, toMs) as HistoryPoint[];
  }

  purgeOlderThan(cutoffMs: number): number {
    const result = this.db.prepare('DELETE FROM readings WHERE ts < ?').run(cutoffMs);
    return result.changes;
  }

  isHealthy(): boolean {
    try {
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.db.close();
  }
}

export function createStore(dbPath: string): Store {
  return new Store(dbPath);
}
