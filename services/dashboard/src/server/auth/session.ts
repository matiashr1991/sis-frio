import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'frio_session';
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_VERSION = 'v1';
const HMAC_CONTEXT = 'frio-session';

/**
 * Derives a per-deployment signing key from the shared password so that
 * rotating DASHBOARD_PASSWORD invalidates every previously issued cookie.
 */
function deriveKey(password: string): Buffer {
  return createHmac('sha256', password).update(HMAC_CONTEXT).digest();
}

function sign(key: Buffer, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('hex');
}

/** Issues a signed session cookie value: `v1.<expMs>.<hmacHex>`. */
export function signSession(password: string, now: number = Date.now()): string {
  const expMs = now + SESSION_MAX_AGE_MS;
  const key = deriveKey(password);
  const payload = `${SESSION_VERSION}.${expMs}`;
  const signature = sign(key, payload);
  return `${payload}.${signature}`;
}

/** Verifies a cookie value against the current password. Rejects tampered or expired cookies. */
export function verifySession(
  password: string,
  cookieValue: string | undefined,
  now: number = Date.now(),
): boolean {
  if (!cookieValue) return false;

  const parts = cookieValue.split('.');
  if (parts.length !== 3) return false;

  const [version, expStr, signature] = parts;
  if (version !== SESSION_VERSION) return false;

  const expMs = Number(expStr);
  if (!Number.isFinite(expMs)) return false;
  if (now >= expMs) return false;

  const key = deriveKey(password);
  const expectedSignature = sign(key, `${version}.${expStr}`);

  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}

/** Constant-time password comparison via fixed-length SHA-256 digests. */
export function checkPassword(configuredPassword: string, submitted: string): boolean {
  const configuredDigest = createHash('sha256').update(configuredPassword).digest();
  const submittedDigest = createHash('sha256').update(submitted).digest();
  return timingSafeEqual(configuredDigest, submittedDigest);
}
