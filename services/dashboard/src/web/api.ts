import type { CamState, Site, HistoryPointTuple, HistoryResponse } from '../server/http/types.js';

export type { CamState, Site, HistoryPointTuple, HistoryResponse };

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'UnauthorizedError';
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });

  if (response.status === 401) {
    throw new UnauthorizedError();
  }
  if (!response.ok) {
    throw new Error(`request to ${path} failed with ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function fetchSites(): Promise<Site[]> {
  return apiFetch<Site[]>('/api/sites');
}

export function fetchHistory(site: string, cam: string): Promise<HistoryResponse> {
  const params = new URLSearchParams({ site, cam });
  return apiFetch<HistoryResponse>(`/api/history?${params.toString()}`);
}

export function login(password: string): Promise<void> {
  return apiFetch<void>('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

export function logout(): Promise<void> {
  return apiFetch<void>('/api/logout', { method: 'POST' });
}

export function openStream(): EventSource {
  return new EventSource('/api/stream');
}
