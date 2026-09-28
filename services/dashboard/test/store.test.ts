import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store/db.js';
import { Hub } from '../src/server/live/hub.js';
import { parseMessage } from '../src/server/ingest/parse.js';
import { buildSites } from '../src/server/http/sites.js';
import { loadConfig } from '../src/server/config.js';
import { buildApp } from '../src/server/http/app.js';
import type { IngestHandle } from '../src/server/ingest/mqtt.js';

test('parse -> store -> snapshot reflects the latest reading and status', () => {
  const store = new Store(':memory:');
  const hub = new Hub();

  const reading = parseMessage('frio/site1/cam1/temp', '4.2');
  assert.ok(reading?.type === 'reading');
  store.insertReading(reading.site, reading.cam, 1000, reading.temp);
  hub.recordReading(reading.site, reading.cam, reading.temp, 1000);

  const status = parseMessage('frio/site1/status', 'online');
  assert.ok(status?.type === 'status');
  store.upsertStatus(status.site, status.status, 1000);

  const sites = buildSites(store, hub);
  assert.equal(sites.length, 1);
  assert.equal(sites[0].site, 'site1');
  assert.equal(sites[0].status, 'online');
  assert.equal(sites[0].cams.length, 1);
  assert.equal(sites[0].cams[0].temp, 4.2);
  assert.equal(sites[0].cams[0].stale, false);

  store.close();
});

test('snapshot ignores a malformed reading that never reaches the store', () => {
  const store = new Store(':memory:');
  const hub = new Hub();

  const parsed = parseMessage('frio/site1/cam1/temp', 'garbage');
  assert.equal(parsed, null);

  const sites = buildSites(store, hub);
  assert.deepEqual(sites, []);

  store.close();
});

test('history buckets readings by the requested bucket size', () => {
  const store = new Store(':memory:');
  store.insertReading('site1', 'cam1', 0, 0);
  store.insertReading('site1', 'cam1', 10_000, 10);
  store.insertReading('site1', 'cam1', 60_000, 20);

  const points = store.getHistory('site1', 'cam1', 0, 120_000, 60);
  assert.equal(points.length, 2);
  assert.equal(points[0].bucketTs, 0);
  assert.equal(points[0].avg, 5);
  assert.equal(points[0].min, 0);
  assert.equal(points[0].max, 10);
  assert.equal(points[1].bucketTs, 60_000);
  assert.equal(points[1].avg, 20);

  store.close();
});

test('purge removes only readings older than the cutoff', () => {
  const store = new Store(':memory:');
  const dayMs = 24 * 60 * 60 * 1000;
  store.insertReading('site1', 'cam1', 0, 1);
  store.insertReading('site1', 'cam1', 31 * dayMs, 2);

  const cutoff = 30 * dayMs;
  const removed = store.purgeOlderThan(cutoff);

  assert.equal(removed, 1);
  const remaining = store.getLatestReadings();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].ts, 31 * dayMs);

  store.close();
});

function fakeIngest(): IngestHandle {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: {} as any,
    isConnected: () => true,
    close: async () => {},
  };
}

test('unauthenticated /api/sites request is rejected with 401', async () => {
  const config = loadConfig({ DASHBOARD_PASSWORD: 'test-password' } as NodeJS.ProcessEnv);
  const store = new Store(':memory:');
  const hub = new Hub();
  const app = await buildApp({ config, store, hub, ingest: fakeIngest() });

  const response = await app.inject({ method: 'GET', url: '/api/sites' });
  assert.equal(response.statusCode, 401);

  await app.close();
  store.close();
});

test('unauthenticated HTML route is redirected to /login', async () => {
  const config = loadConfig({ DASHBOARD_PASSWORD: 'test-password' } as NodeJS.ProcessEnv);
  const store = new Store(':memory:');
  const hub = new Hub();
  const app = await buildApp({ config, store, hub, ingest: fakeIngest() });

  const response = await app.inject({ method: 'GET', url: '/' });
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, '/login');

  await app.close();
  store.close();
});

test('/healthz is public and reports mqtt/db booleans', async () => {
  const config = loadConfig({ DASHBOARD_PASSWORD: 'test-password' } as NodeJS.ProcessEnv);
  const store = new Store(':memory:');
  const hub = new Hub();
  const app = await buildApp({ config, store, hub, ingest: fakeIngest() });

  const response = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { mqtt: true, db: true });

  await app.close();
  store.close();
});

test('correct password grants a session that unlocks /api/sites', async () => {
  const config = loadConfig({ DASHBOARD_PASSWORD: 'test-password' } as NodeJS.ProcessEnv);
  const store = new Store(':memory:');
  const hub = new Hub();
  const app = await buildApp({ config, store, hub, ingest: fakeIngest() });

  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { password: 'test-password' },
  });
  assert.equal(login.statusCode, 204);
  const setCookie = login.headers['set-cookie'];
  assert.ok(setCookie);
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /Secure/);
  assert.match(cookieHeader, /SameSite=Lax/i);
  const cookieValue = cookieHeader.split(';')[0];

  const sitesResponse = await app.inject({
    method: 'GET',
    url: '/api/sites',
    headers: { cookie: cookieValue },
  });
  assert.equal(sitesResponse.statusCode, 200);

  await app.close();
  store.close();
});

test('incorrect password is rejected with 401 and no cookie', async () => {
  const config = loadConfig({ DASHBOARD_PASSWORD: 'test-password' } as NodeJS.ProcessEnv);
  const store = new Store(':memory:');
  const hub = new Hub();
  const app = await buildApp({ config, store, hub, ingest: fakeIngest() });

  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { password: 'wrong-password' },
  });
  assert.equal(login.statusCode, 401);
  assert.equal(login.headers['set-cookie'], undefined);

  await app.close();
  store.close();
});

test('a 6th login attempt within the window is throttled with 429', async () => {
  const config = loadConfig({ DASHBOARD_PASSWORD: 'test-password' } as NodeJS.ProcessEnv);
  const store = new Store(':memory:');
  const hub = new Hub();
  const app = await buildApp({ config, store, hub, ingest: fakeIngest() });

  for (let i = 0; i < 5; i += 1) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { password: 'wrong-password' },
    });
    assert.equal(response.statusCode, 401);
  }

  const sixth = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { password: 'wrong-password' },
  });
  assert.equal(sixth.statusCode, 429);

  await app.close();
  store.close();
});

test('a client-supplied cf-connecting-ip header cannot reset the rate limit', async () => {
  const config = loadConfig({ DASHBOARD_PASSWORD: 'test-password' } as NodeJS.ProcessEnv);
  const store = new Store(':memory:');
  const hub = new Hub();
  const app = await buildApp({ config, store, hub, ingest: fakeIngest() });

  for (let i = 0; i < 5; i += 1) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { password: 'wrong-password' },
    });
    assert.equal(response.statusCode, 401);
  }

  const spoofed = await app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { 'cf-connecting-ip': `1.2.3.${Math.floor(Math.random() * 255)}` },
    payload: { password: 'wrong-password' },
  });
  assert.equal(spoofed.statusCode, 429);

  await app.close();
  store.close();
});
