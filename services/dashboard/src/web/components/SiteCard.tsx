import { useState } from 'preact/hooks';
import type { Site } from '../api';
import { CamTile } from './CamTile';
import { HistoryChart } from './HistoryChart';

interface SiteCardProps {
  site: Site;
}

export function SiteCard({ site }: SiteCardProps) {
  const [selectedCam, setSelectedCam] = useState<string | null>(null);
  const offline = site.status === 'offline';

  return (
    <section class={`site-card${offline ? ' site-card--offline' : ''}`}>
      <header class="site-card__header">
        <h2>{site.site}</h2>
        <span class={`site-status site-status--${site.status}`}>{site.status}</span>
      </header>

      <div class="site-card__cams">
        {site.cams.length === 0 && <p class="site-card__empty">No readings yet.</p>}
        {site.cams.map((cam) => (
          <CamTile
            key={cam.cam}
            cam={cam}
            siteOffline={offline}
            selected={selectedCam === cam.cam}
            onSelect={() => setSelectedCam((current) => (current === cam.cam ? null : cam.cam))}
          />
        ))}
      </div>

      {selectedCam && <HistoryChart site={site.site} cam={selectedCam} />}
    </section>
  );
}
