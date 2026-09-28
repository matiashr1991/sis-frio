import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fastifyRateLimit from '@fastify/rate-limit';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Config } from '../config.js';
import type { Store } from '../store/db.js';
import type { Hub } from '../live/hub.js';
import type { IngestHandle } from '../ingest/mqtt.js';
import { registerAuthGuard } from '../auth/plugin.js';
import { registerRoutes } from './routes.js';
import { registerSse } from './sse.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
// Compiled layout: dist/server/http/app.js -> dist/web
const WEB_DIST = join(moduleDir, '..', '..', 'web');

export interface AppDeps {
  config: Config;
  store: Store;
  hub: Hub;
  ingest: IngestHandle;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, {
    global: false,
  });
  await app.register(fastifyStatic, {
    root: WEB_DIST,
    wildcard: false,
    index: false,
  });

  registerAuthGuard(app, deps.config);
  registerRoutes(app, {
    store: deps.store,
    hub: deps.hub,
    config: deps.config,
    ingest: deps.ingest,
  });
  registerSse(app, deps.hub, deps.store);

  app.get('/login', async (_request, reply) => reply.sendFile('login.html'));
  app.get('/', async (_request, reply) => reply.sendFile('index.html'));

  app.setNotFoundHandler(async (request, reply) => {
    const path = request.raw.url ?? request.url;
    if (request.method === 'GET' && !path.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found' });
  });

  return app;
}
