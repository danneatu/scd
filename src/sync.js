import { fetchReviewsSince } from './appStoreClient.js';
import { upsertReviews, logSync, getLatestReviewDate } from './db.js';

/**
 * Performs an incremental sync: fetches reviews newer than what we already have
 * (falling back to a lookback window if the store is empty) and upserts them.
 *
 * @param {object} options
 * @param {string} options.appId
 * @param {number} [options.lookbackDays] Window to use when the DB is empty (default 35).
 * @param {string} [options.kind]         Label for the sync_log ("daily", "manual", "month").
 */
export async function syncReviews({ appId, lookbackDays = 35, kind = 'manual' } = {}) {
  if (!appId) throw new Error('appId is required.');

  const latest = await getLatestReviewDate(appId);
  // Re-fetch from slightly before the latest stored review to catch edits, or
  // use the lookback window for a cold start.
  let since;
  if (latest) {
    since = new Date(new Date(latest).getTime() - 2 * 24 * 60 * 60 * 1000); // 2-day overlap
  } else {
    since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  }

  const reviews = await fetchReviewsSince({ appId, sinceDate: since });
  const inserted = await upsertReviews(appId, reviews);
  await logSync(appId, { fetched: reviews.length, inserted, kind });

  return { fetched: reviews.length, inserted, since: since.toISOString() };
}

/**
 * Pulls a full window (default last ~35 days) regardless of what's stored,
 * used before generating a monthly report.
 */
export async function syncWindow({ appId, days = 35, kind = 'month' } = {}) {
  if (!appId) throw new Error('appId is required.');
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const reviews = await fetchReviewsSince({ appId, sinceDate: since });
  const inserted = await upsertReviews(appId, reviews);
  await logSync(appId, { fetched: reviews.length, inserted, kind });
  return { fetched: reviews.length, inserted, since: since.toISOString() };
}
