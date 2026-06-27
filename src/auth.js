import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

// Single-password dashboard auth. Enabled only when DASHBOARD_PASSWORD is set,
// so local development stays open and zero-config.

const COOKIE_NAME = 'ara_session';
const MAX_AGE_DAYS = 30;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

export const COOKIE = COOKIE_NAME;

/** Auth is active only when a dashboard password has been configured. */
export function authEnabled() {
  return Boolean(process.env.DASHBOARD_PASSWORD);
}

/**
 * Secret used to sign session tokens. Prefer an explicit SESSION_SECRET; if it
 * isn't set, derive a stable secret from the password so issued cookies survive
 * restarts and redeploys without extra configuration.
 */
function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  return crypto
    .createHash('sha256')
    .update(`ara:${process.env.DASHBOARD_PASSWORD || ''}`)
    .digest('hex');
}

/** Constant-time password comparison to avoid timing side channels. */
export function checkPassword(input) {
  const expected = process.env.DASHBOARD_PASSWORD || '';
  if (!expected || typeof input !== 'string') return false;
  const a = Buffer.from(input, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    // Compare equal-length buffers anyway so failures take the same time.
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/** Issues a signed session token valid for MAX_AGE_DAYS. */
export function issueToken() {
  return jwt.sign({ sub: 'dashboard' }, sessionSecret(), {
    expiresIn: `${MAX_AGE_DAYS}d`,
  });
}

function verifyToken(token) {
  try {
    jwt.verify(token, sessionSecret());
    return true;
  } catch {
    return false;
  }
}

/** Cookie options shared by login (set) and logout (clear). */
export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_MS,
    path: '/',
  };
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

// Paths reachable without a valid session (the login screen + its endpoints).
const PUBLIC_PATHS = new Set([
  '/login',
  '/login.html',
  '/api/login',
  '/api/logout',
  '/favicon.ico',
]);

/**
 * Express middleware. When auth is enabled, requires a valid session cookie for
 * every request except the login flow. HTML page requests are redirected to the
 * login screen; API/other requests get a 401.
 */
export function requireAuth(req, res, next) {
  if (!authEnabled()) return next();
  if (PUBLIC_PATHS.has(req.path)) return next();

  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token && verifyToken(token)) return next();

  const wantsHtml =
    req.method === 'GET' && (req.headers.accept || '').includes('text/html');
  if (wantsHtml) return res.redirect('/login');
  return res.status(401).json({ error: 'Authentication required' });
}
