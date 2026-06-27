// Shared daily job: the scheduled work that keeps the dashboard fresh.
//
// Runs the same sequence whether triggered by the in-process node-cron
// (src/scheduler.js) or by an external scheduler such as GitHub Actions
// (scripts/daily-job.mjs). Designed to be free-tier friendly: it does the
// LLM report generation here (Groq free tier) and caches it in the database,
// so the dashboard serves an up-to-date report instantly even on a host that
// sleeps between requests.
//
// Steps:
//   1. Sync new reviews from App Store Connect
//   2. Capture today's aggregate ratings snapshot (iTunes totals)
//   3. Generate + cache this month's LLM insights report
//   4. Email any new written reviews (if notifications are configured)

import { syncReviews } from './sync.js';
import { checkAndNotify, notifyConfigured } from './notify.js';
import { fetchRatingsSummary } from './ratings.js';
import { captureRatingSnapshot } from './ratingsHistory.js';
import {
  getAllReviews,
  getReviewsBetween,
  saveReport,
} from './db.js';
import { generateMonthlyReport } from './insights.js';

/** Current month as "YYYY-MM" (UTC). */
function currentMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "YYYY-MM" immediately before the given one. */
function previousMonth(month) {
  const [year, mon] = month.split('-').map(Number);
  const d = new Date(Date.UTC(year, mon - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Inclusive ISO start/end for a "YYYY-MM" month. */
function monthRange(month) {
  const [year, mon] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, mon - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, mon, 1, 0, 0, 0, 0) - 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

const log = (...args) => console.log('[daily]', ...args);
const warn = (...args) => console.error('[daily]', ...args);

/**
 * Runs the full daily job. Each step is best-effort: a failure in one step is
 * logged and the others still run, so a transient API hiccup never aborts the
 * whole run.
 *
 * @param {object}  options
 * @param {string}  options.appId
 * @param {boolean} [options.generateReport=true] Generate + cache the LLM report.
 * @param {boolean} [options.notify=true]         Send new-review email(s).
 * @returns {Promise<{sync?:object, snapshotDay?:string|null, report?:string, emailed?:number}>}
 */
export async function runDailyJob({ appId, generateReport = true, notify = true } = {}) {
  if (!appId) throw new Error('appId is required.');
  const result = {};

  // 1. Sync new reviews.
  try {
    const sync = await syncReviews({ appId, kind: 'daily' });
    result.sync = sync;
    log(`sync: fetched ${sync.fetched}, new ${sync.inserted}.`);
  } catch (err) {
    warn('sync failed:', err.message);
  }

  // 2. Capture today's aggregate ratings snapshot.
  try {
    const writtenCount = (await getAllReviews(appId)).length;
    const summary = await fetchRatingsSummary({ appId, force: true, writtenCount });
    const day = await captureRatingSnapshot(appId, summary);
    result.snapshotDay = day;
    if (day) log(`snapshot ${day}: ${summary.totalRatings} total, avg ${summary.averageRating}★.`);
  } catch (err) {
    warn('ratings snapshot failed:', err.message);
  }

  // 3. Generate + cache this month's LLM insights report.
  if (generateReport) {
    try {
      const month = currentMonth();
      const { startIso, endIso } = monthRange(month);
      const reviews = await getReviewsBetween(appId, startIso, endIso);
      const prev = monthRange(previousMonth(month));
      const previousReviews = await getReviewsBetween(appId, prev.startIso, prev.endIso);
      const report = await generateMonthlyReport({ month, reviews, previousReviews });
      await saveReport(appId, month, report.source, report);
      result.report = report.source;
      log(`report ${month}: generated via ${report.source}, ${reviews.length} reviews.`);
    } catch (err) {
      warn('report generation failed:', err.message);
    }
  }

  // 4. Email new written reviews.
  if (notify && notifyConfigured()) {
    try {
      const notice = await checkAndNotify({ appId });
      if (notice.sent) {
        result.emailed = notice.count;
        log(`emailed ${notice.count} new written review(s).`);
      } else if (notice.reason && notice.reason !== 'no_new') {
        log(`no email sent (${notice.reason}).`);
      }
    } catch (err) {
      warn('email notification failed:', err.message);
    }
  }

  return result;
}
