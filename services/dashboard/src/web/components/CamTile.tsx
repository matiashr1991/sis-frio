import type { CamState } from '../api';

interface CamTileProps {
  cam: CamState;
  siteOffline: boolean;
  selected: boolean;
  onSelect: () => void;
}

export function CamTile({ cam, siteOffline, selected, onSelect }: CamTileProps) {
  const status = siteOffline ? 'offline' : cam.stale ? 'stale' : 'live';

  return (
    <button
      type="button"
      class={`cam-tile cam-tile--${status}${selected ? ' cam-tile--selected' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span class="cam-tile__name">{cam.cam}</span>
      <span class="cam-tile__temp">{cam.temp.toFixed(1)}°C</span>
      <span class="cam-tile__updated">{new Date(cam.ts).toLocaleTimeString()}</span>
      {status === 'stale' && (
        <span class="cam-tile__badge" title="No reading in the last ~30s">
          stale
        </span>
      )}
      {status === 'offline' && (
        <span class="cam-tile__badge cam-tile__badge--offline" title="Site is offline">
          offline
        </span>
      )}
    </button>
  );
}
