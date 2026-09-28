import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/server/config.js';

test('loadConfig rejects a non-numeric RETENTION_DAYS instead of producing NaN', () => {
  assert.throws(
    () =>
      loadConfig({
        DASHBOARD_PASSWORD: 'test-password',
        RETENTION_DAYS: 'not-a-number',
      } as NodeJS.ProcessEnv),
    /RETENTION_DAYS must be a finite number/,
  );
});

test('loadConfig rejects a non-numeric STALE_AFTER_MS instead of producing NaN', () => {
  assert.throws(
    () =>
      loadConfig({
        DASHBOARD_PASSWORD: 'test-password',
        STALE_AFTER_MS: 'soon',
      } as NodeJS.ProcessEnv),
    /STALE_AFTER_MS must be a finite number/,
  );
});

test('loadConfig accepts valid numeric overrides', () => {
  const config = loadConfig({
    DASHBOARD_PASSWORD: 'test-password',
    RETENTION_DAYS: '7',
    STALE_AFTER_MS: '60000',
    PORT: '9090',
  } as NodeJS.ProcessEnv);

  assert.equal(config.retentionDays, 7);
  assert.equal(config.staleAfterMs, 60000);
  assert.equal(config.port, 9090);
});
