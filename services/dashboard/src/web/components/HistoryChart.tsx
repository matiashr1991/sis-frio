import { useEffect, useRef, useState } from 'preact/hooks';
import uPlot from 'uplot';
import { fetchHistory } from '../api';

interface HistoryChartProps {
  site: string;
  cam: string;
}

export function HistoryChart({ site, cam }: HistoryChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    fetchHistory(site, cam)
      .then((history) => {
        if (cancelled || !containerRef.current) return;

        const timestamps = history.points.map((point) => point[0] / 1000);
        const avg = history.points.map((point) => point[1]);
        const min = history.points.map((point) => point[2]);
        const max = history.points.map((point) => point[3]);

        plotRef.current?.destroy();
        plotRef.current = new uPlot(
          {
            width: containerRef.current.clientWidth || 600,
            height: 220,
            series: [
              {},
              { label: 'avg °C', stroke: '#38bdf8', width: 2 },
              { label: 'min °C', stroke: '#64748b', width: 1 },
              { label: 'max °C', stroke: '#f97316', width: 1 },
            ],
            scales: { x: { time: true } },
          },
          [timestamps, avg, min, max],
          containerRef.current,
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'failed to load history');
      });

    return () => {
      cancelled = true;
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [site, cam]);

  if (error) {
    return <p class="history-chart__error">History unavailable: {error}</p>;
  }

  return <div class="history-chart" ref={containerRef} />;
}
