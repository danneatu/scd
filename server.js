import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { fetchCustomerReviews } from './src/appStoreClient.js';
import { analyzeReviews } from './src/analyzer.js';
import { syncReviews, syncWindow } from './src/sync.js';
import {
  getReviewsBetween,
  getRecentSyncs,
  getLatestReviewDate,
  saveReport,
  getLatestReport,
  getAllReviews,
  initDb,
  dbDriver,
} from './src/db.js';
import { generateMonthlyReport } from './src/insights.js';
import { reportLanguage } from './src/reviewAgent.js';
import { llmInfo, llmComplete, llmConfigured } from './src/llm.js';
import { fetchRatingsSummary } from './src/ratings.js';
import {
  seedRatingBaselines,
  captureRatingSnapshot,
  getRatingsComparison,
  addManualSnapshot,
  removeSnapshot,
} from './src/ratingsHistory.js';
import { getDownloadsSummary, getVersionAdoption, salesConfigured } from './src/downloads.js';
import { startScheduler } from './src/scheduler.js';
import { notifyInfo, notifyConfigured, sendTestEmail } from './src/notify.js';
import { ocrRatingsImage } from './src/ratingsOcr.js';
import { enforceSecretPermissions } from './src/security.js';
import {
  authEnabled,
  checkPassword,
  issueToken,
  cookieOptions,
  requireAuth,
  COOKIE,
} from './src/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_APP_ID = process.env.APP_ID || '1181860241';

// Behind a hosting proxy (e.g. Render), trust X-Forwarded-* so secure cookies
// and req.secure work correctly.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(express.json({ limit: '15mb' }));

// --- Optional single-password auth (enabled when DASHBOARD_PASSWORD is set) ---
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', (req, res) => {
  if (!authEnabled()) return res.json({ ok: true });
  const { password } = req.body || {};
  if (!checkPassword(password)) {
    return res.status(401).json({ error: 'Falsches Passwort.' });
  }
  res.cookie(COOKIE, issueToken(), cookieOptions());
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

// Everything below this line requires a valid session when auth is enabled.
app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

// Security guard: refuse to boot if secret files (.env / .p8) are readable by
// anyone other than their owner, so loose permissions can't silently leak keys.
enforceSecretPermissions({ rootDir: __dirname });

function credentialsConfigured() {
  return Boolean(
    process.env.ASC_ISSUER_ID &&
      process.env.ASC_KEY_ID &&
      (process.env.ASC_PRIVATE_KEY || process.env.ASC_PRIVATE_KEY_PATH)
  );
}

/** Returns the current month as "YYYY-MM" (UTC). */
function currentMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Returns inclusive ISO start/end for a "YYYY-MM" month. */
function monthRange(month) {
  const [year, mon] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, mon - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, mon, 1, 0, 0, 0, 0) - 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** Returns the "YYYY-MM" month immediately before the given one. */
function previousMonth(month) {
  const [year, mon] = month.split('-').map(Number);
  const d = new Date(Date.UTC(year, mon - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Loads the previous month's reviews (for month-over-month trend detection). */
async function loadPreviousMonthReviews(appId, month) {
  const { startIso, endIso } = monthRange(previousMonth(month));
  return getReviewsBetween(appId, startIso, endIso);
}

function handleError(res, err) {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({ error: err.message });
}

/* ===================== Input validation (defense-in-depth) ===================== */
// The DB layer uses parameterized queries / prepared statements, so SQL string
// injection isn't possible. These validators enforce *data integrity*: only
// well-formed, bounded values ever reach the database, and malformed or
// unexpected payloads are rejected with a 400 instead of being stored.

/** Hard upper bound for any rating count (sanity cap, ~Apple-scale). */
const MAX_RATINGS = 5_000_000_000;

/** Builds a 400 Bad Request error carrying an HTTP status. */
function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/** Validates a numeric App Store app ID (digits only, sane length). */
function sanitizeAppId(value) {
  const id = String(value ?? '').trim();
  if (!/^[0-9]{1,16}$/.test(id)) {
    throw badRequest('Invalid app ID.');
  }
  return id;
}

/** True only for a real YYYY-MM-DD calendar date in a sensible range. */
function isValidDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const ts = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ts)) return false;
  // Round-trip rejects impossible dates (e.g. 2024-02-31 → 2024-03-02).
  if (new Date(ts).toISOString().slice(0, 10) !== day) return false;
  const year = Number(day.slice(0, 4));
  // App Store launched in 2008; allow up to ~1 day ahead for timezone slack.
  return year >= 2008 && ts <= Date.now() + 86_400_000;
}

/**
 * Validates + normalizes a manual ratings-snapshot payload before it is
 * persisted. Returns a clean object containing only the allowed, bounded
 * fields. Throws a 400 on anything malformed.
 */
function validateSnapshotPayload(body) {
  const src = body && typeof body === 'object' ? body : {};
  const out = {};

  // day — optional; must be a real calendar date in range.
  if (src.day != null && src.day !== '') {
    if (!isValidDay(src.day)) {
      throw badRequest('Invalid "day": expected a real YYYY-MM-DD date.');
    }
    out.day = src.day;
  }

  // distribution — optional object keyed by star 1..5 → non-negative integers.
  if (src.distribution != null) {
    const d = src.distribution;
    if (typeof d !== 'object' || Array.isArray(d)) {
      throw badRequest('Invalid "distribution": expected an object of star counts.');
    }
    const allowed = new Set(['1', '2', '3', '4', '5']);
    for (const key of Object.keys(d)) {
      if (!allowed.has(String(key))) {
        throw badRequest(`Unexpected key in "distribution": ${String(key).slice(0, 20)}.`);
      }
    }
    const clean = {};
    let any = false;
    for (const star of [1, 2, 3, 4, 5]) {
      const raw = d[star] ?? d[String(star)] ?? 0;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > MAX_RATINGS) {
        throw badRequest(`Invalid count for ${star}★ rating.`);
      }
      clean[star] = Math.round(n);
      if (clean[star] > 0) any = true;
    }
    if (!any) throw badRequest('"distribution" must contain at least one positive count.');
    out.distribution = clean;
  }

  // totalRatings — optional non-negative integer.
  if (src.totalRatings != null) {
    const n = Number(src.totalRatings);
    if (!Number.isFinite(n) || n < 0 || n > MAX_RATINGS) {
      throw badRequest('Invalid "totalRatings".');
    }
    out.totalRatings = Math.round(n);
  }

  // averageRating — optional number within 0..5.
  if (src.averageRating != null) {
    const n = Number(src.averageRating);
    if (!Number.isFinite(n) || n < 0 || n > 5) {
      throw badRequest('Invalid "averageRating": must be between 0 and 5.');
    }
    out.averageRating = Number(n.toFixed(2));
  }

  if (!out.distribution && out.totalRatings == null) {
    throw badRequest('Provide a star distribution or a totalRatings value.');
  }
  return out;
}

/**
 * Validates an inbound image payload for OCR (data URL or bare base64). Does not
 * touch the DB, but guards against non-string / oversized / non-image inputs.
 */
function validateImagePayload(image) {
  if (typeof image !== 'string' || image.length < 32) {
    throw badRequest('Provide an "image" (data URL or base64).');
  }
  // ~20 MB of base64 ≈ 15 MB binary, matching the JSON body limit.
  if (image.length > 20 * 1024 * 1024) {
    throw badRequest('Image is too large.');
  }
  const dataUrl = /^data:image\/(png|jpe?g|webp|gif|bmp|heic|heif);base64,/i;
  const bareBase64 = /^[A-Za-z0-9+/=\r\n]+$/;
  if (!dataUrl.test(image) && !bareBase64.test(image)) {
    throw badRequest('Unsupported image format.');
  }
  return image;
}

/**
 * Reports configuration status for credentials, LLM, and the daily schedule.
 */
app.get('/api/config', (req, res) => {
  res.json({
    configured: credentialsConfigured(),
    defaultAppId: DEFAULT_APP_ID,
    llm: llmInfo(),
    sales: { configured: salesConfigured() },
    schedule: process.env.SYNC_CRON || '0 6 * * *',
    reportLanguage: reportLanguage(),
    notify: notifyInfo(),
    auth: { enabled: authEnabled() },
  });
});

/**
 * Quick connectivity check for the configured LLM provider. Makes a tiny live
 * request and reports success/failure (never exposes the API key).
 */
app.get('/api/llm-test', async (req, res) => {
  const info = llmInfo();
  if (!llmConfigured()) {
    return res.status(409).json({
      ok: false,
      configured: false,
      error: 'No LLM provider configured. Set LLM_PROVIDER (and LLM_API_KEY) in .env.',
      ...info,
    });
  }
  const started = Date.now();
  try {
    const reply = await llmComplete({
      system: 'You are a connectivity test. Reply with exactly one short word.',
      user: 'Respond with the single word: OK',
    });
    res.json({
      ok: true,
      configured: true,
      provider: info.provider,
      model: info.model,
      free: info.free,
      latencyMs: Date.now() - started,
      reply: String(reply || '').trim().slice(0, 80),
    });
  } catch (err) {
    res.status(502).json({
      ok: false,
      configured: true,
      provider: info.provider,
      model: info.model,
      latencyMs: Date.now() - started,
      error: err.message,
    });
  }
});

/**
 * Sends a test notification email (uses recent written reviews as a preview).
 * Confirms that NOTIFY_TO + a backend (Resend or SMTP) are wired up correctly.
 */
app.post('/api/notify-test', async (req, res) => {
  const appId = req.query.appId || DEFAULT_APP_ID;
  if (!notifyConfigured()) {
    return res.status(409).json({
      ok: false,
      configured: false,
      error:
        'Email notifications are not configured. Set NOTIFY_TO and either RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS in .env.',
      ...notifyInfo(),
    });
  }
  try {
    const result = await sendTestEmail({ appId });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(err.status && err.status === 409 ? 409 : 502).json({
      ok: false,
      configured: notifyConfigured(),
      ...notifyInfo(),
      error: err.message,
    });
  }
});

/**
 * Live fetch + analysis straight from the API (no storage). Kept for ad-hoc use.
 */
app.get('/api/reviews', async (req, res) => {
  const appId = req.query.appId || DEFAULT_APP_ID;
  const max = Math.min(Number(req.query.max) || 500, 5000);
  const territory = req.query.territory || undefined;
  const sort = req.query.sort || '-createdDate';

  try {
    const reviews = await fetchCustomerReviews({ appId, maxReviews: max, territory, sort });
    const analysis = analyzeReviews(reviews);
    res.json({ appId, count: reviews.length, analysis, reviews });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * Triggers an incremental sync (the same job the daily scheduler runs).
 */
app.post('/api/sync', async (req, res) => {
  const appId = req.body?.appId || req.query.appId || DEFAULT_APP_ID;
  // Always pull a fixed window (default last 90 days) regardless of the
  // dashboard's selected month, so a manual sync is self-contained.
  const days = Number(req.body?.days || req.query.days) || 90;
  try {
    const result = await syncWindow({ appId, days, kind: 'manual' });
    res.json({ appId, days, ...result });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * Returns the stored dashboard state for a given month (default: current month),
 * computed from the local database. Add ?sync=1 to refresh from the API first.
 */
app.get('/api/dashboard', async (req, res) => {
  const appId = req.query.appId || DEFAULT_APP_ID;
  const month = req.query.month || currentMonth();
  const doSync = req.query.sync === '1';

  try {
    let lastSync = null;
    if (doSync) lastSync = await syncReviews({ appId, kind: 'manual' });

    const { startIso, endIso } = monthRange(month);
    const reviews = await getReviewsBetween(appId, startIso, endIso);
    const analysis = analyzeReviews(reviews);

    const [recentSyncs, latestReviewDate] = await Promise.all([
      getRecentSyncs(appId, 5),
      getLatestReviewDate(appId),
    ]);

    res.json({
      appId,
      month,
      count: reviews.length,
      analysis,
      reviews,
      lastSync: lastSync || recentSyncs[0] || null,
      latestReviewDate,
      recentSyncs,
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * Generates (or returns a cached) monthly insights report.
 * Query: { appId, month=YYYY-MM, refresh=1 }
 */
app.get('/api/monthly-report', async (req, res) => {
  const appId = req.query.appId || DEFAULT_APP_ID;
  const month = req.query.month || currentMonth();
  const refresh = req.query.refresh === '1';

  try {
    if (!refresh) {
      const cached = await getLatestReport(appId, month);
      if (cached) {
        return res.json({ appId, month, cached: true, createdAt: cached.createdAt, ...cached.report });
      }
    }

    // Ensure fresh data for the window covering this month.
    const now = new Date();
    const isCurrent = month === currentMonth();
    const days = isCurrent ? now.getUTCDate() + 3 : 35;
    let syncNote;
    try {
      await syncWindow({ appId, days, kind: 'report' });
    } catch (err) {
      // Sync failing (e.g. missing review key) shouldn't block analysis of
      // already-stored reviews — degrade gracefully.
      syncNote = `Could not refresh from App Store Connect (${err.message}). Analyzed stored reviews.`;
    }

    const { startIso, endIso } = monthRange(month);
    const reviews = await getReviewsBetween(appId, startIso, endIso);
    const previousReviews = await loadPreviousMonthReviews(appId, month);
    const report = await generateMonthlyReport({ month, reviews, previousReviews });
    await saveReport(appId, month, report.source, report);

    if (syncNote && !report.note) report.note = syncNote;
    res.json({ appId, month, cached: false, ...report });
  } catch (err) {
    handleError(res, err);
  }
});

/** Returns the previous N months as "YYYY-MM", newest first, including `month`. */
function recentMonths(month, n) {
  const [year, mon] = month.split('-').map(Number);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const d = new Date(Date.UTC(year, mon - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** Average rating of a list of reviews, rounded to one decimal (or null). */
function averageRating(reviews) {
  const rated = reviews.filter((r) => typeof r.rating === 'number');
  if (!rated.length) return null;
  const sum = rated.reduce((acc, r) => acc + r.rating, 0);
  return Math.round((sum / rated.length) * 10) / 10;
}

/** Groups a month's reviews into day buckets (newest day first). */
function groupByDay(reviews) {
  const byDay = new Map();
  for (const r of reviews) {
    const day = (r.createdDate || '').slice(0, 10);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(r);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, list]) => ({
      date,
      count: list.length,
      averageRating: averageRating(list),
      reviews: list,
    }));
}

/**
 * Returns the most recent `limit` months (scanning back up to `lookback`
 * months) that actually contain written reviews, newest first.
 */
async function availableMonths(appId, limit = 3, lookback = 24) {
  const out = [];
  for (const m of recentMonths(currentMonth(), lookback)) {
    const { startIso, endIso } = monthRange(m);
    const list = await getReviewsBetween(appId, startIso, endIso);
    if (list.length) {
      out.push({ month: m, count: list.length, averageRating: averageRating(list) });
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * Written-reviews section: a day-by-day listing of written reviews (per selected
 * month), a multi-month overview, and the insights report (pain points / praise)
 * aggregated across the selected months. Powers the "Written reviews" panel and
 * the PDF export.
 *
 * Query:
 *   appId
 *   months=2026-06,2026-05   comma-separated YYYY-MM to include (default: most
 *                            recent month with reviews). Capped to last 3.
 *   refresh=1                pull fresh reviews first and regenerate the report
 */
app.get('/api/written-reviews', async (req, res) => {
  const appId = req.query.appId || DEFAULT_APP_ID;
  const refresh = req.query.refresh === '1';

  try {
    let syncNote;
    if (refresh) {
      const now = new Date();
      const days = now.getUTCDate() + 3 + 62; // current month + ~2 months back
      try {
        await syncWindow({ appId, days, kind: 'report' });
      } catch (err) {
        syncNote = `Could not refresh from App Store Connect (${err.message}). Showing stored reviews.`;
      }
    }

    // The months the user may pick from (last 3 with reviews).
    const choices = await availableMonths(appId, 3);
    const choiceSet = new Set(choices.map((c) => c.month));

    // Parse + validate the requested selection; cap to the allowed choices.
    const requested = String(req.query.months || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d{4}-\d{2}$/.test(s) && choiceSet.has(s));
    // Default: the most recent month that has reviews (or current month).
    let selected = requested.length ? requested : choices.slice(0, 1).map((c) => c.month);
    if (!selected.length) selected = [currentMonth()];
    // Newest first, unique.
    selected = [...new Set(selected)].sort((a, b) => (a < b ? 1 : -1));

    // Per-month sections (day-by-day) + the union of reviews for the report.
    const sections = [];
    let allReviews = [];
    for (const m of selected) {
      const { startIso, endIso } = monthRange(m);
      const list = await getReviewsBetween(appId, startIso, endIso);
      allReviews = allReviews.concat(list);
      sections.push({
        month: m,
        total: list.length,
        averageRating: averageRating(list),
        days: groupByDay(list),
      });
    }

    // Overview cards mirror the available choices (so the user sees all options).
    const overview = choices;

    // Aggregated insights report across the selected months. Cache per unique
    // selection so repeated views are instant; refresh regenerates.
    const cacheKey = selected.join(',');
    let report = null;
    if (!refresh) {
      const cached = await getLatestReport(appId, cacheKey);
      if (cached) report = { cached: true, ...cached.report };
    }
    if (!report) {
      // Trend baseline: the month just before the earliest selected month.
      const earliest = selected[selected.length - 1];
      const previousReviews = await loadPreviousMonthReviews(appId, earliest);
      report = await generateMonthlyReport({
        month: cacheKey,
        reviews: allReviews,
        previousReviews,
      });
      await saveReport(appId, cacheKey, report.source, report);
    }

    res.json({
      appId,
      months: selected,
      availableMonths: choices,
      total: allReviews.length,
      averageRating: averageRating(allReviews),
      overview,
      sections,
      report,
      note: syncNote,
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * Aggregate ratings overview across App Store storefronts (public iTunes data).
 * Includes star-only ratings, which the customerReviews API never returns.
 * Query: { appId, force=1 }
 */
app.get('/api/ratings-summary', async (req, res) => {
  const appId = req.query.appId || DEFAULT_APP_ID;
  const force = req.query.force === '1';
  try {
    const writtenCount = (await getAllReviews(appId)).length;
    const summary = await fetchRatingsSummary({ appId, force, writtenCount });
    // Store today's snapshot so it can be compared against future days.
    try {
      await captureRatingSnapshot(appId, summary);
    } catch {
      /* snapshot capture is best-effort */
    }
    res.json(summary);
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * Ratings-over-time: baseline (earliest stored snapshot) vs latest, with the
 * full snapshot timeline. Seeds known manual baselines on first call.
 * Query: { appId }
 */
app.get('/api/ratings-history', async (req, res) => {
  const appId = req.query.appId || DEFAULT_APP_ID;
  try {
    await seedRatingBaselines(appId);
    res.json({ appId, ...(await getRatingsComparison(appId)) });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * Adds a manual ratings snapshot (e.g. from a fresh App Store Connect screenshot).
 * Body: { day?, distribution?: {1..5}, totalRatings?, averageRating? }
 */
app.post('/api/ratings-snapshot', async (req, res) => {
  try {
    const appId = sanitizeAppId(req.query.appId || DEFAULT_APP_ID);
    const payload = validateSnapshotPayload(req.body || {});
    await addManualSnapshot(appId, payload);
    res.json({ appId, ...(await getRatingsComparison(appId)) });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * Deletes a stored ratings snapshot (e.g. a mistaken upload).
 * Query: { appId?, day=YYYY-MM-DD, source? }. Without `source`, removes every
 * snapshot stored for that day.
 */
app.delete('/api/ratings-snapshot', async (req, res) => {
  try {
    const appId = sanitizeAppId(req.query.appId || DEFAULT_APP_ID);
    const day = req.query.day;
    if (!isValidDay(day)) {
      throw badRequest('Invalid "day": expected a real YYYY-MM-DD date.');
    }
    const source = req.query.source ? String(req.query.source).slice(0, 20) : null;
    const removed = await removeSnapshot(appId, { day, source });
    res.json({ appId, removed, ...(await getRatingsComparison(appId)) });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * Reads a star breakdown from an uploaded App Store Connect ratings screenshot
 * using local OCR (Tesseract). Does NOT save anything — it returns the parsed
 * numbers so the UI can pre-fill the form for the user to confirm.
 * Body: { image: <data URL or base64> }
 */
app.post('/api/ratings-ocr', async (req, res) => {
  try {
    const image = validateImagePayload(req.body?.image);
    const parsed = await ocrRatingsImage(image);
    if (!parsed.distribution) {
      return res.status(422).json({
        error: 'Could not read a star breakdown from that image. Enter the numbers manually.',
        detectedNumbers: parsed.detectedNumbers,
        rawText: parsed.rawText,
      });
    }
    res.json(parsed);
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * Daily timeline of written reviews, bucketed per calendar day and split by
 * star (1..5), for the last `days` days (default 90). Includes the latest
 * release date (auto-detected via iTunes) so the UI can mark release impact.
 *
 * Query: { appId, days=90 }
 * Returns: {
 *   appId, days, start, end,
 *   buckets: [{ day:'YYYY-MM-DD', total, stars:{1..5}, avg }...],  // dense, gap-filled
 *   totals: { count, avg, stars:{1..5} },
 *   releases: [{ version, date:'YYYY-MM-DD' }],
 *   maxDayTotal
 * }
 */
app.get('/api/reviews-timeline', async (req, res) => {
  const appId = req.query.appId || DEFAULT_APP_ID;
  const days = Math.min(Math.max(Number(req.query.days) || 90, 7), 730);
  try {
    const end = new Date();
    const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    const startDay = start.toISOString().slice(0, 10);
    const endDay = end.toISOString().slice(0, 10);
    const startIso = `${startDay}T00:00:00.000Z`;
    const endIso = `${endDay}T23:59:59.999Z`;

    const reviews = await getReviewsBetween(appId, startIso, endIso);

    // Bucket by calendar day (local-to-UTC day from the stored ISO date).
    const byDay = new Map();
    for (const r of reviews) {
      if (!r.createdDate) continue;
      const day = new Date(r.createdDate).toISOString().slice(0, 10);
      let b = byDay.get(day);
      if (!b) {
        b = { day, total: 0, stars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, sum: 0 };
        byDay.set(day, b);
      }
      const star = Number(r.rating) || 0;
      if (star >= 1 && star <= 5) {
        b.stars[star] += 1;
        b.sum += star;
        b.total += 1;
      }
    }

    // Dense, gap-filled series from startDay..endDay.
    const buckets = [];
    const totals = { count: 0, sum: 0, stars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    let maxDayTotal = 0;
    const cursor = new Date(`${startDay}T00:00:00.000Z`);
    const last = new Date(`${endDay}T00:00:00.000Z`);
    while (cursor <= last) {
      const day = cursor.toISOString().slice(0, 10);
      const b = byDay.get(day);
      const total = b ? b.total : 0;
      const stars = b ? b.stars : { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      const avg = total > 0 ? Number((b.sum / total).toFixed(2)) : null;
      buckets.push({ day, total, stars, avg });
      if (total > maxDayTotal) maxDayTotal = total;
      totals.count += total;
      if (b) {
        totals.sum += b.sum;
        for (let s = 1; s <= 5; s += 1) totals.stars[s] += stars[s];
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    // Release marker(s): the current store version's publish date, if in range.
    const releases = [];
    const info = await detectLatestVersion(appId);
    if (info.releaseDate) {
      const relDay = new Date(info.releaseDate).toISOString().slice(0, 10);
      if (relDay >= startDay && relDay <= endDay) {
        releases.push({ version: info.version || null, date: relDay });
      }
    }

    res.json({
      appId,
      days,
      start: startDay,
      end: endDay,
      buckets,
      totals: {
        count: totals.count,
        avg: totals.count > 0 ? Number((totals.sum / totals.count).toFixed(2)) : null,
        stars: totals.stars,
      },
      releases,
      maxDayTotal,
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * Tries to detect the app's release year (for the downloads all-time floor),
 * via the public iTunes lookup. Falls back to undefined on failure.
 */
async function detectReleaseYear(appId) {
  try {
    const res = await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(appId)}`);
    if (!res.ok) return undefined;
    const data = await res.json();
    const rel = data.results?.[0]?.releaseDate;
    if (!rel) return undefined;
    const year = new Date(rel).getUTCFullYear();
    return Number.isFinite(year) ? year : undefined;
  } catch {
    return undefined;
  }
}

/** Detects the current/latest store version + its release date via iTunes lookup. */
async function detectLatestVersion(appId) {
  try {
    const res = await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(appId)}`);
    if (!res.ok) return {};
    const data = await res.json();
    const r = data.results?.[0] || {};
    return { version: r.version || undefined, releaseDate: r.currentVersionReleaseDate || undefined };
  } catch {
    return {};
  }
}

/**
 * Downloads overview from Sales Reports (needs a Sales-role key + vendor number).
 * Query: { appId, force=1 }
 */
app.get('/api/downloads-summary', async (req, res) => {
  const appId = req.query.appId || DEFAULT_APP_ID;
  const force = req.query.force === '1';
  if (!salesConfigured()) {
    return res.status(409).json({
      error:
        'Sales reporting not configured. Add SALES_KEY_ID, SALES_PRIVATE_KEY_PATH and SALES_VENDOR_NUMBER (Sales-role key) to your .env.',
      needsConfig: true,
    });
  }
  try {
    const startYear = await detectReleaseYear(appId);
    const summary = await getDownloadsSummary({ startYear, force });
    res.json({ appId, ...summary });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * Latest-version adoption: how many devices are on the latest version vs. the
 * total install base. Query: { appId, version=2.42.0, since=YYYY-MM-DD, force=1 }
 */
app.get('/api/version-adoption', async (req, res) => {
  const appId = req.query.appId || DEFAULT_APP_ID;
  const force = req.query.force === '1';
  if (!salesConfigured()) {
    return res.status(409).json({
      error:
        'Sales reporting not configured. Add SALES_KEY_ID, SALES_PRIVATE_KEY_PATH and SALES_VENDOR_NUMBER (Sales-role key) to your .env.',
      needsConfig: true,
    });
  }
  try {
    const info = await detectLatestVersion(appId);
    const latestVersion = req.query.version || info.version;
    const releaseDate = req.query.since || info.releaseDate;
    const data = await getVersionAdoption({ latestVersion, releaseDate, force });
    res.json({ appId, ...data });
  } catch (err) {
    handleError(res, err);
  }
});

app.listen(PORT, async () => {
  console.log(`\n  App Ratings Analyzer running at http://localhost:${PORT}`);
  console.log(`  Default app ID: ${DEFAULT_APP_ID}`);
  const llm = llmInfo();
  console.log(`  Summarizer: ${llm.configured ? `${llm.provider} (${llm.model})` : 'local heuristic (no LLM key)'}`);
  console.log(`  Sales reports: ${salesConfigured() ? 'configured' : 'not configured (downloads disabled)'}`);

  // Initialize the data store (SQLite locally, Postgres in production).
  try {
    await initDb();
    console.log(`  Data store: ${dbDriver()}`);
  } catch (err) {
    console.error('  Data store failed to initialize:', err.message);
  }

  // Seed any known ratings baselines (e.g. captured ASC screenshots).
  try {
    await seedRatingBaselines(DEFAULT_APP_ID);
  } catch (err) {
    console.warn('  Could not seed rating baselines:', err.message);
  }

  if (credentialsConfigured()) {
    startScheduler({ appId: DEFAULT_APP_ID });
  } else {
    console.log('  Credentials not set — daily sync disabled until configured.');
  }
  console.log('');
});

