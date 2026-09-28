export interface CamState {
  cam: string;
  temp: number;
  ts: number;
  stale: boolean;
}

export interface Site {
  site: string;
  status: 'online' | 'offline' | 'unknown';
  statusTs: number | null;
  cams: CamState[];
}

export type HistoryPointTuple = [t: number, avg: number, min: number, max: number];

export interface HistoryResponse {
  site: string;
  cam: string;
  bucket: number;
  points: HistoryPointTuple[];
}
