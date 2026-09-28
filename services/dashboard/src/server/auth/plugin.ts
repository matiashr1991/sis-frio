import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import { SESSION_COOKIE_NAME, verifySession } from './session.js';

const PUBLIC_EXACT_PATHS = new Set<string>([
  '/login',
  '/login.html',
  '/healthz',
  '/api/login',
  '/manifest.webmanifest',
  '/sw.js',
  '/favicon.ico',
]);

const PUBLIC_PREFIXES = ['/assets/', '/icons/', '/workbox-'];

function isPublicPath(path: string): boolean {
  if (PUBLIC_EXACT_PATHS.has(path)) return true;
  return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Registers the global auth gate directly on the root app instance (not as an
 * encapsulated plugin) so it runs for every route, including static files.
 * `/api/*` gets 401 when unauthenticated; every other non-public route gets a
 * 302 redirect to `/login`, per dashboard-access-control.
 */
export function registerAuthGuard(app: FastifyInstance, config: Config): void {
  app.addHook('onRequest', async (request, reply) => {
    const path = (request.raw.url ?? request.url).split('?')[0] ?? '/';

    if (isPublicPath(path)) return;

    const cookieValue = request.cookies[SESSION_COOKIE_NAME];
    if (verifySession(config.dashboardPassword, cookieValue)) return;

    if (path.startsWith('/api/')) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }

    await reply.redirect('/login');
  });
}
