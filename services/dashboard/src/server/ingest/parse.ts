export const SEGMENT_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const MIN_TEMP_C = -55;
export const MAX_TEMP_C = 125;

export interface ParsedReading {
  type: 'reading';
  site: string;
  cam: string;
  temp: number;
}

export interface ParsedStatus {
  type: 'status';
  site: string;
  status: 'online' | 'offline';
}

export type ParsedMessage = ParsedReading | ParsedStatus;

/**
 * Parses an incoming MQTT topic + payload pair.
 * Returns null for anything that does not match a known shape or fails
 * validation — callers must log and drop, never throw or persist.
 */
export function parseMessage(topic: string, payload: string): ParsedMessage | null {
  const parts = topic.split('/');

  if (parts.length === 4 && parts[0] === 'frio' && parts[3] === 'temp') {
    return parseReading(parts[1], parts[2], payload);
  }

  if (parts.length === 3 && parts[0] === 'frio' && parts[2] === 'status') {
    return parseStatus(parts[1], payload);
  }

  return null;
}

function parseReading(site: string, cam: string, payload: string): ParsedReading | null {
  if (!SEGMENT_RE.test(site) || !SEGMENT_RE.test(cam)) return null;

  const temp = Number(payload.trim());
  if (!Number.isFinite(temp)) return null;
  if (temp < MIN_TEMP_C || temp > MAX_TEMP_C) return null;

  return { type: 'reading', site, cam, temp };
}

function parseStatus(site: string, payload: string): ParsedStatus | null {
  if (!SEGMENT_RE.test(site)) return null;

  const value = payload.trim();
  if (value !== 'online' && value !== 'offline') return null;

  return { type: 'status', site, status: value };
}
