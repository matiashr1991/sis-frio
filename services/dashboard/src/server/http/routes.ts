import type { FastifyInstance } from 'fastify';
import type { Store } from '../store/db.js';
import type { Hub } from '../live/hub.js';
import type { Config } from '../config.js';
import type { IngestHandle } from '../ingest/mqtt.js';
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  checkPassword,
  signSession,
} from '../auth/session.js';
import { buildSites } from './sites.js';
import type { HistoryResponse } from './types.js';

export interface RouteDeps {
  store: Store;
  hub: Hub;
  config: Config;
  ingest: IngestHandle;
}

const DEFAULT_HISTORY_RANGE_MS = 24 * 60 * 60 * 1000;
const MAX_HISTORY_RANGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BUCKET_COUNT = 2000;
const DEFAULT_BUCKET_SECONDS = 60;

interface LoginBody {
  password?: string;
}

interface HistoryQuery {
  site?: string;
  cam?: string;
  from?: string;
  to?: string;
  bucket?: string;
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { store, hub, config, ingest } = deps;

  app.post<{ Body: LoginBody }>(
    '/api/login',
    {
      config: {
        rateLimit: { max: 5, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const password = request.body?.password;
      if (typeof password !== 'string' || !checkPassword(config.dashboardPassword, password)) {
        return reply.code(401).send({ error: 'invalid_password' });
      }

      const cookieValue = signSession(config.dashboardPassword);
      reply.setCookie(SESSION_COOKIE_NAME, cookieValue, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: Math.floor(SESSION_MAX_AGE_MS / 1000),
      });
      return reply.code(204).send();
    },
  );

  app.post('/api/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/sites', async () => buildSites(store, hub));

  app.get<{ Querystring: HistoryQuery }>('/api/history', async (request, reply) => {
    const { site, cam } = request.query;
    if (!site || !cam) {
      return reply.code(400).send({ error: 'site and cam query params are required' });
    }

    const now = Date.now();
    const to = request.query.to ? Number(request.query.to) : now;
    let from = request.query.from ? Number(request.query.from) : to - DEFAULT_HISTORY_RANGE_MS;

    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      return reply.code(400).send({ error: 'invalid from/to range' });
    }

    if (to - from > MAX_HISTORY_RANGE_MS) {
      from = to - MAX_HISTORY_RANGE_MS;
    }

    const rangeSeconds = (to - from) / 1000;
    const minBucketSeconds = Math.max(1, Math.ceil(rangeSeconds / MAX_BUCKET_COUNT));

    let bucketSeconds = request.query.bucket ? Number(request.query.bucket) : DEFAULT_BUCKET_SECONDS;
    if (!Number.isFinite(bucketSeconds) || bucketSeconds <= 0) {
      bucketSeconds = DEFAULT_BUCKET_SECONDS;
    }
    bucketSeconds = Math.max(bucketSeconds, minBucketSeconds);

    const rows = store.getHistory(site, cam, from, to, bucketSeconds);
    const response: HistoryResponse = {
      site,
      cam,
      bucket: bucketSeconds,
      points: rows.map((row) => [row.bucketTs, row.avg, row.min, row.max]),
    };
    return response;
  });

  app.get('/healthz', async () => ({
    mqtt: ingest.isConnected(),
    db: store.isHealthy(),
  }));
}
