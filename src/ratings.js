/**
 * Aggregate ratings via the public iTunes Lookup API.
 *
 * The App Store Connect `customerReviews` endpoint only returns *written*
 * reviews. Star-only ratings are never exposed individually, but the public
 * iTunes Lookup API returns the *total* rating count (which includes star-only
 * ratings) and the average, per storefront (country). Summing across storefronts
 * gives a worldwide picture and lets us show written vs. star-only.
 *
 * No authentication required.
 */

// iTunes Store storefronts (ISO 3166-1 alpha-2 country codes). ~175 entries.
export const STOREFRONTS = [
  'us', 'gb', 'de', 'ch', 'fr', 'at', 'it', 'es', 'nl', 'ca', 'au', 'ie', 'be',
  'lu', 'pt', 'se', 'no', 'dk', 'fi', 'is', 'pl', 'cz', 'sk', 'hu', 'ro', 'bg',
  'gr', 'hr', 'si', 'lt', 'lv', 'ee', 'mt', 'cy', 'jp', 'cn', 'kr', 'hk', 'tw',
  'sg', 'my', 'th', 'id', 'ph', 'vn', 'in', 'pk', 'lk', 'bd', 'np', 'kh', 'la',
  'mm', 'mn', 'mo', 'bn', 'nz', 'fj', 'pg', 'ru', 'ua', 'by', 'kz', 'az', 'am',
  'ge', 'md', 'tr', 'il', 'sa', 'ae', 'qa', 'kw', 'bh', 'om', 'jo', 'lb', 'eg',
  'ma', 'dz', 'tn', 'ly', 'za', 'ng', 'ke', 'gh', 'tz', 'ug', 'zm', 'zw', 'mz',
  'mu', 'mg', 'ao', 'bw', 'na', 'sn', 'ci', 'cm', 'bj', 'bf', 'ml', 'ne', 'cv',
  'mx', 'br', 'ar', 'cl', 'co', 'pe', 've', 'ec', 'uy', 'py', 'bo', 'cr', 'pa',
  'gt', 'hn', 'ni', 'sv', 'do', 'jm', 'tt', 'bb', 'bs', 'bz', 'gy', 'sr', 'ag',
  'dm', 'gd', 'kn', 'lc', 'vc', 'ky', 'ai', 'vg', 'ms', 'tc', 'pr', 'uz', 'kg',
  'tj', 'tm', 'af', 'iq', 'ye', 'qa', 'fm', 'pw', 'mh', 'sb', 'to', 'vu', 'ws',
  'nr', 'ki', 'tv', 'gm', 'gw', 'gn', 'lr', 'sl', 'tg', 'cg', 'cd', 'cf', 'td',
  'ga', 'gq', 'st', 'sc', 'km', 'sz', 'ls', 'mw', 'rw', 'bi', 'dj', 'mr',
];

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map(); // appId -> { at, data }

/**
 * Fetches the aggregate rating for one storefront. Returns null on miss/error.
 */
async function lookupOne(appId, country) {
  try {
    const res = await fetch(
      `https://itunes.apple.com/lookup?id=${encodeURIComponent(appId)}&country=${country}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const r = data.results?.[0];
    if (!r || !r.userRatingCount) return null;
    return {
      country,
      count: r.userRatingCount ?? 0,
      average: r.averageUserRating ?? null,
      countCurrentVersion: r.userRatingCountForCurrentVersion ?? 0,
      averageCurrentVersion: r.averageUserRatingForCurrentVersion ?? null,
      trackName: r.trackName,
    };
  } catch {
    return null;
  }
}

/**
 * Runs an async mapper over items with a bounded concurrency.
 */
async function mapWithConcurrency(items, limit, mapper) {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await mapper(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Aggregates ratings across storefronts for an app.
 *
 * @param {object} options
 * @param {string} options.appId
 * @param {string[]} [options.countries] Defaults to all known storefronts.
 * @param {number} [options.concurrency] Parallel requests (default 12).
 * @param {boolean} [options.force]      Bypass the cache.
 * @param {number} [options.writtenCount] Written-review count, to compute the star-only split.
 */
export async function fetchRatingsSummary({
  appId,
  countries = STOREFRONTS,
  concurrency = 12,
  force = false,
  writtenCount = null,
} = {}) {
  if (!appId) throw new Error('appId is required.');

  const cached = cache.get(appId);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ...cached.data, cached: true, writtenReviews: writtenCount ?? cached.data.writtenReviews };
  }

  const raw = await mapWithConcurrency(countries, concurrency, (c) => lookupOne(appId, c));
  const perStorefront = raw
    .filter(Boolean)
    .sort((a, b) => b.count - a.count);

  const totalRatings = perStorefront.reduce((s, r) => s + (r.count || 0), 0);
  const weightedSum = perStorefront.reduce(
    (s, r) => s + (r.average != null ? r.average * r.count : 0),
    0
  );
  const averageRating = totalRatings ? Number((weightedSum / totalRatings).toFixed(2)) : null;

  const written = writtenCount ?? 0;
  const data = {
    appId,
    storefrontsQueried: countries.length,
    storefrontsWithRatings: perStorefront.length,
    totalRatings,
    averageRating,
    writtenReviews: written,
    starOnlyEstimate: Math.max(totalRatings - written, 0),
    writtenPercent: totalRatings ? Number(((written / totalRatings) * 100).toFixed(1)) : null,
    perStorefront,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };

  cache.set(appId, { at: Date.now(), data });
  return data;
}
