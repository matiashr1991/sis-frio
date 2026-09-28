import { signal } from '@preact/signals';
import { fetchSites, openStream, type CamState, type Site } from './api';

export const sites = signal<Site[]>([]);
export const streamConnected = signal(false);
export const authError = signal(false);

function upsertCam(site: Site, cam: CamState): Site {
  const existingIndex = site.cams.findIndex((c) => c.cam === cam.cam);
  const cams = [...site.cams];
  if (existingIndex >= 0) {
    cams[existingIndex] = cam;
  } else {
    cams.push(cam);
    cams.sort((a, b) => a.cam.localeCompare(b.cam));
  }
  return { ...site, cams };
}

function withSite(list: Site[], siteName: string, update: (site: Site) => Site): Site[] {
  const index = list.findIndex((s) => s.site === siteName);
  if (index === -1) {
    return list;
  }
  const next = [...list];
  next[index] = update(next[index]);
  return next;
}

export async function initLiveDashboard(): Promise<void> {
  try {
    sites.value = await fetchSites();
  } catch (err) {
    if (err instanceof Error && err.name === 'UnauthorizedError') {
      authError.value = true;
      return;
    }
    throw err;
  }

  const source = openStream();

  source.addEventListener('open', () => {
    streamConnected.value = true;
  });

  source.addEventListener('snapshot', (event) => {
    sites.value = JSON.parse((event as MessageEvent).data) as Site[];
  });

  source.addEventListener('reading', (event) => {
    const data = JSON.parse((event as MessageEvent).data) as {
      site: string;
      cam: string;
      temp: number;
      ts: number;
    };
    sites.value = withSite(sites.value, data.site, (site) =>
      upsertCam(site, { cam: data.cam, temp: data.temp, ts: data.ts, stale: false }),
    );
  });

  source.addEventListener('status', (event) => {
    const data = JSON.parse((event as MessageEvent).data) as {
      site: string;
      status: 'online' | 'offline';
      ts: number;
    };
    sites.value = withSite(sites.value, data.site, (site) => ({
      ...site,
      status: data.status,
      statusTs: data.ts,
    }));
  });

  source.addEventListener('stale', (event) => {
    const data = JSON.parse((event as MessageEvent).data) as {
      site: string;
      cam: string;
      stale: boolean;
      lastTs: number;
    };
    sites.value = withSite(sites.value, data.site, (site) =>
      upsertCam(site, {
        cam: data.cam,
        temp: site.cams.find((c) => c.cam === data.cam)?.temp ?? 0,
        ts: data.lastTs,
        stale: data.stale,
      }),
    );
  });

  source.addEventListener('error', () => {
    streamConnected.value = false;
    void fetchSites().catch((err) => {
      if (err instanceof Error && err.name === 'UnauthorizedError') {
        authError.value = true;
      }
    });
  });
}
