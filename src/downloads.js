import { fetchSalesReportTsv, parseSalesTsv, salesConfigured } from './salesClient.js';

export { salesConfigured };

/**
 * Classifies an App Store "Product Type Identifier" into a category.
 * See Apple's "Product Type Identifiers" reference. Heuristic but transparent —
 * the per-type breakdown is always returned so totals can be verified.
 */
function classifyType(typeId) {
  const t = (typeId || '').toUpperCase();
  if (t.startsWith('7')) return 'updates';
  if (t.startsWith('IA') || t === '3' || t.startsWith('FI')) return 'inApp';
  if (t.startsWith('1') || t.startsWith('F')) return 'downloads';
  return 'other';
}

/**
 * Aggregates parsed sales rows into download/update/in-app totals, plus a
 * per-country and per-type breakdown.
 */
function aggregateRows(rows) {
  const agg = {
    downloads: 0,
    updates: 0,
    inApp: 0,
    other: 0,
    total: 0,
    byCountry: {},
    byType: {},
  };
  for (const row of rows) {
    const units = parseInt(row.Units || row.units || '0', 10);
    if (!Number.isFinite(units) || units === 0) continue;
    const typeId = row['Product Type Identifier'] || row['Product Type Identifier '] || '';
    const category = classifyType(typeId);
    agg[category] += units;
    agg.total += units;
    agg.byType[typeId] = (agg.byType[typeId] || 0) + units;
    if (category === 'downloads') {
      const cc = row['Country Code'] || row['Provider Country'] || row.Country || '??';
      agg.byCountry[cc] = (agg.byCountry[cc] || 0) + units;
    }
  }
  return agg;
}

function emptyAgg() {
  return { downloads: 0, updates: 0, inApp: 0, other: 0, total: 0, byCountry: {}, byType: {} };
}

function mergeAgg(target, src) {
  if (!src) return target;
  target.downloads += src.downloads;
  target.updates += src.updates;
  target.inApp += src.inApp;
  target.other += src.other;
  target.total += src.total;
  for (const [cc, n] of Object.entries(src.byCountry)) {
    target.byCountry[cc] = (target.byCountry[cc] || 0) + n;
  }
  for (const [t, n] of Object.entries(src.byType)) {
    target.byType[t] = (target.byType[t] || 0) + n;
  }
  return target;
}

/** Bounded-concurrency async map. */
async function mapWithConcurrency(items, limit, mapper) {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await mapper(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Fetches + aggregates a single report; null when there's no data. */
async function aggregateReport(frequency, reportDate) {
  const tsv = await fetchSalesReportTsv({ frequency, reportDate });
  if (!tsv) return null;
  return aggregateRows(parseSalesTsv(tsv));
}

/* ---------- date helpers (UTC) ---------- */

function pad(n) {
  return String(n).padStart(2, '0');
}
function ymd(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function ym(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Returns an array of YYYY-MM-DD strings from start to end inclusive. */
function enumerateDays(start, end) {
  const days = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cur <= last) {
    days.push(ymd(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

/**
 * Sums daily reports across a date range (inclusive).
 */
async function sumDailyRange(start, end, concurrency = 8) {
  const days = enumerateDays(start, end);
  const parts = await mapWithConcurrency(days, concurrency, (d) => aggregateReport('DAILY', d));
  return parts.reduce((acc, p) => mergeAgg(acc, p), emptyAgg());
}

const cache = new Map(); // key -> { at, data }
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * Builds a downloads summary: last 30 days, month-to-date, year-to-date, and
 * an all-time total (yearly reports for past years + monthly + daily for the
 * current year). Sales data lags ~1-2 days, so the most recent days may be 0.
 *
 * @param {object} options
 * @param {number} [options.startYear] Earliest year to include for all-time.
 * @param {boolean} [options.force]    Bypass cache.
 */
export async function getDownloadsSummary({ startYear, force = false } = {}) {
  const cacheKey = `dl:${startYear || 'auto'}`;
  const cached = cache.get(cacheKey);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ...cached.data, cached: true };
  }

  const now = new Date();
  const SALES_LAG_DAYS = 2; // most recent day reliably available
  const lastAvailable = new Date(now);
  lastAvailable.setUTCDate(lastAvailable.getUTCDate() - SALES_LAG_DAYS);

  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth(); // 0-based
  const floorYear = startYear || Number(process.env.DOWNLOADS_START_YEAR) || 2016;

  // --- Last 30 days (daily) ---
  const start30 = new Date(lastAvailable);
  start30.setUTCDate(start30.getUTCDate() - 29);
  const last30 = await sumDailyRange(start30, lastAvailable);

  // --- Month to date (daily) ---
  const monthStart = new Date(Date.UTC(currentYear, currentMonth, 1));
  const monthToDate = await sumDailyRange(monthStart, lastAvailable);

  // --- Current-year completed months (monthly reports) ---
  const completedMonths = [];
  for (let m = 0; m < currentMonth; m += 1) {
    completedMonths.push(`${currentYear}-${pad(m + 1)}`);
  }
  const monthlyParts = await mapWithConcurrency(completedMonths, 6, (mm) =>
    aggregateReport('MONTHLY', mm)
  );
  const yearCompleted = monthlyParts.reduce((acc, p) => mergeAgg(acc, p), emptyAgg());
  // Year to date = completed months + current month-to-date.
  const yearToDate = mergeAgg(mergeAgg(emptyAgg(), yearCompleted), monthToDate);

  // --- Previous full years (yearly reports) ---
  const years = [];
  for (let y = floorYear; y < currentYear; y += 1) years.push(String(y));
  const yearlyParts = await mapWithConcurrency(years, 6, (yy) => aggregateReport('YEARLY', yy));
  const priorYears = yearlyParts.reduce((acc, p) => mergeAgg(acc, p), emptyAgg());

  // --- All time = prior full years + this year to date ---
  const allTime = mergeAgg(mergeAgg(emptyAgg(), priorYears), yearToDate);

  const topCountries = Object.entries(allTime.byCountry)
    .map(([country, downloads]) => ({ country, downloads }))
    .sort((a, b) => b.downloads - a.downloads)
    .slice(0, 30);

  const data = {
    last30Days: last30.downloads,
    monthToDate: monthToDate.downloads,
    yearToDate: yearToDate.downloads,
    allTime: allTime.downloads,
    updatesAllTime: allTime.updates,
    inAppAllTime: allTime.inApp,
    totalUnitsAllTime: allTime.total,
    byType: allTime.byType,
    topCountries,
    coverage: { fromYear: floorYear, throughDate: ymd(lastAvailable) },
    fetchedAt: new Date().toISOString(),
    cached: false,
  };

  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}

/**
 * Estimates how many devices are on the latest version, vs. the total install
 * base, using Sales Reports.
 *
 * Key idea: the newest version is the only one nobody has updated *away* from
 * yet, so the cumulative acquisitions (fresh downloads + updates) onto it since
 * its release date equal the number of distinct devices that have moved onto it
 * (each device updates to a given version exactly once). We compare that to the
 * all-time first-time downloads (the total install base).
 *
 * Caveats surfaced to the UI: the install base counts every device that ever
 * installed (including long-churned ones), so the resulting percentage is a
 * conservative floor. The true "live active devices on version X" snapshot is
 * only available from App Analytics, not Sales Reports.
 *
 * @param {object} options
 * @param {string} [options.latestVersion] Version to measure (auto-detect if omitted).
 * @param {string} [options.releaseDate]   ISO date the latest version shipped (bounds the window).
 * @param {boolean} [options.force]        Bypass cache.
 */
export async function getVersionAdoption({ latestVersion, releaseDate, force = false } = {}) {
  const cacheKey = `ver:${latestVersion || 'auto'}:${releaseDate || 'na'}`;
  const cached = cache.get(cacheKey);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ...cached.data, cached: true };
  }

  const now = new Date();
  const SALES_LAG_DAYS = 2;
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() - SALES_LAG_DAYS);

  // Window start: the release date (with a 1-day buffer) so we capture the
  // version's entire life. Fall back to a 120-day lookback if unknown.
  let start;
  if (releaseDate && !Number.isNaN(Date.parse(releaseDate))) {
    start = new Date(releaseDate);
    start.setUTCDate(start.getUTCDate() - 1);
  } else {
    start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 119);
  }
  if (start > end) start = new Date(end);

  const dayList = enumerateDays(start, end);
  const tsvParts = await mapWithConcurrency(dayList, 8, async (d) => {
    const tsv = await fetchSalesReportTsv({ frequency: 'DAILY', reportDate: d });
    return tsv ? parseSalesTsv(tsv) : null;
  });

  const byVersion = new Map(); // version -> { version, downloads, updates, total }
  for (const rows of tsvParts) {
    if (!rows) continue;
    for (const row of rows) {
      const units = parseInt(row.Units || '0', 10);
      if (!Number.isFinite(units) || units === 0) continue;
      const version = (row.Version || '').trim() || '(unknown)';
      const category = classifyType(row['Product Type Identifier'] || '');
      if (category !== 'downloads' && category !== 'updates') continue;
      const bucket = byVersion.get(version) || { version, downloads: 0, updates: 0, total: 0 };
      bucket[category] += units;
      bucket.total += units;
      byVersion.set(version, bucket);
    }
  }

  // Pick the latest version: explicit > highest semver seen in the window.
  const detected =
    latestVersion ||
    [...byVersion.keys()]
      .filter((v) => /^\d+(\.\d+)*$/.test(v))
      .sort(cmpSemver)
      .pop() ||
    null;

  const onLatest = byVersion.get(detected) || {
    version: detected,
    downloads: 0,
    updates: 0,
    total: 0,
  };

  // The previous version = highest semver strictly below the latest that we saw
  // receiving acquisitions in the window. Useful for labelling only — we cannot
  // count how many devices are *still* on it (Sales Reports never record the
  // version a device updated away from; that needs App Analytics).
  const previousVersion =
    [...byVersion.keys()]
      .filter((v) => /^\d+(\.\d+)*$/.test(v) && detected && cmpSemver(v, detected) < 0)
      .sort(cmpSemver)
      .pop() || null;

  // Total install base = all-time first-time downloads (shares the 6h cache).
  let totalInstallBase = null;
  try {
    const dl = await getDownloadsSummary({ force: false });
    totalInstallBase = dl.allTime;
  } catch {
    /* base stays null; UI handles the missing comparison */
  }

  const shareOfBase =
    totalInstallBase && totalInstallBase > 0
      ? Number(((onLatest.total / totalInstallBase) * 100).toFixed(1))
      : null;

  // Devices on ANY older version (not yet on latest). Exact within the same
  // install-base caveat; we cannot split this across individual old versions.
  const notOnLatest =
    totalInstallBase != null ? Math.max(0, totalInstallBase - onLatest.total) : null;
  const notOnLatestShare =
    totalInstallBase && totalInstallBase > 0
      ? Number(((notOnLatest / totalInstallBase) * 100).toFixed(1))
      : null;

  const data = {
    latestVersion: detected,
    previousVersion,
    releaseDate: releaseDate || null,
    coverageFrom: ymd(start),
    coverageThrough: ymd(end),
    windowDays: dayList.length,
    onLatest: {
      version: detected,
      downloads: onLatest.downloads,
      updates: onLatest.updates,
      total: onLatest.total,
    },
    totalInstallBase,
    shareOfBase,
    notOnLatest,
    notOnLatestShare,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };

  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}

/** Compares two dotted version strings; returns -1/0/1. */
function cmpSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

