import { loadConfig } from './config.js';
import { createStore } from './store/db.js';
import { createHub } from './live/hub.js';
import { startStaleTicker } from './live/stale.js';
import { startRetentionJob } from './retention.js';
import { startIngest } from './ingest/mqtt.js';
import { buildApp } from './http/app.js';

async function main(): Promise<void> {
  const config = loadConfig();

  const store = createStore(config.dbPath);

  const hub = createHub();
  hub.seed(store.getMaxTsPerCam());

  const stopStaleTicker = startStaleTicker(hub, config.staleAfterMs);
  const stopRetentionJob = startRetentionJob(store, config.retentionDays);
  const ingest = startIngest(config.mqttUrl, store, hub);

  const app = await buildApp({ config, store, hub, ingest });

  await app.listen({ host: '0.0.0.0', port: config.port });
  app.log.info(`dashboard listening on :${config.port}`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`received ${signal}, shutting down`);

    stopStaleTicker();
    stopRetentionJob();

    await ingest.close();
    await app.close();
    store.close();

    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('fatal startup error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
