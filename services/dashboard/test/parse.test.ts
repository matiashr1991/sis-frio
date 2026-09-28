import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage } from '../src/server/ingest/parse.js';

test('valid reading is parsed', () => {
  const result = parseMessage('frio/site1/cam1/temp', '4.2');
  assert.deepEqual(result, { type: 'reading', site: 'site1', cam: 'cam1', temp: 4.2 });
});

test('malformed (non-numeric) payload is discarded, not thrown', () => {
  assert.equal(parseMessage('frio/site1/cam1/temp', 'not-a-number'), null);
});

test('disconnect sentinel -127 is rejected as out of range', () => {
  assert.equal(parseMessage('frio/site1/cam1/temp', '-127'), null);
});

test('boundary temps -55 and 125 are accepted', () => {
  assert.deepEqual(parseMessage('frio/site1/cam1/temp', '-55'), {
    type: 'reading',
    site: 'site1',
    cam: 'cam1',
    temp: -55,
  });
  assert.deepEqual(parseMessage('frio/site1/cam1/temp', '125'), {
    type: 'reading',
    site: 'site1',
    cam: 'cam1',
    temp: 125,
  });
});

test('temps outside [-55, 125] are rejected', () => {
  assert.equal(parseMessage('frio/site1/cam1/temp', '125.1'), null);
  assert.equal(parseMessage('frio/site1/cam1/temp', '-55.1'), null);
});

test('valid online status is parsed', () => {
  assert.deepEqual(parseMessage('frio/site1/status', 'online'), {
    type: 'status',
    site: 'site1',
    status: 'online',
  });
});

test('valid offline status is parsed', () => {
  assert.deepEqual(parseMessage('frio/site1/status', 'offline'), {
    type: 'status',
    site: 'site1',
    status: 'offline',
  });
});

test('unknown status value is dropped', () => {
  assert.equal(parseMessage('frio/site1/status', 'unreachable'), null);
});

test('unrelated topic shapes are dropped', () => {
  assert.equal(parseMessage('frio/site1/cam1/humidity', '50'), null);
  assert.equal(parseMessage('other/site1/status', 'online'), null);
  assert.equal(parseMessage('frio/site1', 'x'), null);
});

test('segments with invalid characters or length are rejected', () => {
  assert.equal(parseMessage('frio/site 1/cam1/temp', '4.2'), null);
  const longSite = 'a'.repeat(65);
  assert.equal(parseMessage(`frio/${longSite}/status`, 'online'), null);
});
