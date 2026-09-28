import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hub } from '../src/server/live/hub.js';

test('cam goes stale while site status is untouched (independent of online/offline)', () => {
  const hub = new Hub();
  const t0 = 1_000_000;
  hub.recordReading('site1', 'cam1', 4.2, t0);

  assert.equal(hub.isStale('site1', 'cam1'), false);

  const staleAfterMs = 30_000;
  const transitions = hub.tick(t0 + 35_000, staleAfterMs);

  assert.equal(transitions.length, 1);
  assert.deepEqual(transitions[0], { site: 'site1', cam: 'cam1', stale: true, lastTs: t0 });
  assert.equal(hub.isStale('site1', 'cam1'), true);
});

test('stale transition fires once, not on every tick', () => {
  const hub = new Hub();
  const t0 = 1_000_000;
  hub.recordReading('site1', 'cam1', 4.2, t0);

  hub.tick(t0 + 35_000, 30_000);
  const secondTick = hub.tick(t0 + 40_000, 30_000);

  assert.equal(secondTick.length, 0);
});

test('fresh reading clears stale immediately and emits stale:false', () => {
  const hub = new Hub();
  const t0 = 1_000_000;
  hub.recordReading('site1', 'cam1', 4.2, t0);
  hub.tick(t0 + 35_000, 30_000);
  assert.equal(hub.isStale('site1', 'cam1'), true);

  const events: unknown[] = [];
  hub.on('stale', (event) => events.push(event));

  hub.recordReading('site1', 'cam1', 4.5, t0 + 36_000);

  assert.equal(hub.isStale('site1', 'cam1'), false);
  assert.deepEqual(events, [
    { site: 'site1', cam: 'cam1', stale: false, lastTs: t0 + 36_000 },
  ]);
});

test('seed() populates lastTs so restart-time staleness derives from DB state', () => {
  const hub = new Hub();
  const t0 = 1_000_000;
  hub.seed([{ site: 'site1', cam: 'cam1', ts: t0 }]);

  const transitions = hub.tick(t0 + 35_000, 30_000);
  assert.equal(transitions.length, 1);
  assert.equal(hub.isStale('site1', 'cam1'), true);
});
