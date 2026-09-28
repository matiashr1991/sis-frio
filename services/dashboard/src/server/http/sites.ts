import type { Store } from '../store/db.js';
import type { Hub } from '../live/hub.js';
import type { CamState, Site } from './types.js';

/**
 * Builds the current `Site[]` snapshot from SQLite (source of truth for
 * values and status) joined with the in-memory hub (source of truth for
 * staleness). Used by both `GET /api/sites` and the SSE `snapshot` event.
 */
export function buildSites(store: Store, hub: Hub): Site[] {
  const readings = store.getLatestReadings();
  const statuses = new Map(store.getStatuses().map((row) => [row.site, row]));
  const camsBySite = new Map<string, CamState[]>();

  for (const reading of readings) {
    const cams = camsBySite.get(reading.site) ?? [];
    cams.push({
      cam: reading.cam,
      temp: reading.temp,
      ts: reading.ts,
      stale: hub.isStale(reading.site, reading.cam),
    });
    camsBySite.set(reading.site, cams);
  }

  const siteNames = new Set<string>([...camsBySite.keys(), ...statuses.keys()]);

  return [...siteNames].sort().map((site): Site => {
    const statusRow = statuses.get(site);
    const cams = (camsBySite.get(site) ?? []).sort((a, b) => a.cam.localeCompare(b.cam));

    return {
      site,
      status: statusRow?.status ?? 'unknown',
      statusTs: statusRow?.ts ?? null,
      cams,
    };
  });
}
