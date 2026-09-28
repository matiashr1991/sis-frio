import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPassword, signSession, verifySession } from '../src/server/auth/session.js';

test('sign/verify round trip succeeds for the same password', () => {
  const password = 'correct-horse-battery-staple';
  const cookie = signSession(password, 1_000_000);
  assert.equal(verifySession(password, cookie, 1_000_001), true);
});

test('verify fails for a different password (rotation revokes sessions)', () => {
  const cookie = signSession('password-a', 1_000_000);
  assert.equal(verifySession('password-b', cookie, 1_000_001), false);
});

test('tampered cookie value is rejected', () => {
  const password = 'correct-horse-battery-staple';
  const cookie = signSession(password, 1_000_000);
  const [version, expMs] = cookie.split('.');
  const tampered = `${version}.${Number(expMs) + 1_000_000_000}.deadbeef`;
  assert.equal(verifySession(password, tampered, 1_000_001), false);
});

test('expired cookie is rejected', () => {
  const password = 'correct-horse-battery-staple';
  const cookie = signSession(password, 1_000_000);
  const [, expMsStr] = cookie.split('.');
  const expMs = Number(expMsStr);
  assert.equal(verifySession(password, cookie, expMs + 1), false);
});

test('missing or malformed cookie is rejected', () => {
  assert.equal(verifySession('password', undefined), false);
  assert.equal(verifySession('password', ''), false);
  assert.equal(verifySession('password', 'not-a-valid-cookie'), false);
  assert.equal(verifySession('password', 'v2.123.abc'), false);
});

test('checkPassword accepts the correct password and rejects others', () => {
  assert.equal(checkPassword('correct-value', 'correct-value'), true);
  assert.equal(checkPassword('correct-value', 'wrong-value'), false);
  assert.equal(checkPassword('correct-value', ''), false);
  assert.equal(checkPassword('short', 'a-much-longer-different-string'), false);
});
