import type { FastifyInstance } from 'fastify';
import type { ServerResponse } from 'node:http';
import type { Hub, ReadingEvent, StatusEvent, StaleEvent } from '../live/hub.js';
import type { Store } from '../store/db.js';
import { buildSites } from './sites.js';

const HEARTBEAT_MS = 15000;

function writeEvent(res: ServerResponse, event: string, data: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function registerSse(app: FastifyInstance, hub: Hub, store: Store): void {
  app.get('/api/stream', async (request, reply) => {
    reply.hijack();
    const res = reply.raw;

    // A client disconnecting mid-write emits 'error' on the hijacked raw
    // response; without a handler that crashes the whole process.
    res.on('error', () => cleanup());

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 5000\n\n');
    writeEvent(res, 'snapshot', buildSites(store, hub));

    const onReading = (event: ReadingEvent) => writeEvent(res, 'reading', event);
    const onStatus = (event: StatusEvent) => writeEvent(res, 'status', event);
    const onStale = (event: StaleEvent) => writeEvent(res, 'stale', event);

    hub.on('reading', onReading);
    hub.on('status', onStatus);
    hub.on('stale', onStale);

    const heartbeat = setInterval(() => {
      if (res.writableEnded || res.destroyed) return;
      res.write(': ping\n\n');
    }, HEARTBEAT_MS);

    const cleanup = (): void => {
      clearInterval(heartbeat);
      hub.off('reading', onReading);
      hub.off('status', onStatus);
      hub.off('stale', onStale);
    };

    request.raw.on('close', cleanup);
  });
}
