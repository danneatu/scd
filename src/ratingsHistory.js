import {
  saveRatingSnapshot,
  getRatingSnapshots,
  getFirstRatingSnapshot,
  getLatestRatingSnapshot,
  hasRatingSnapshot,
  deleteRatingSnapshot,
} from './db.js';

/**
 * Known manual baselines captured from App Store Connect screenshots.
 * These are global (all-territories) rating totals + the star distribution,
 * which the public iTunes API never exposes. Keyed by appId.
 */
const MANUAL_BASELINES = {
  // App Store Connect "iOS Ratings" snapshots (global, all territories).
  '1181860241': [
    {
      day: '2026-01-13',
      distribution: { 5: 20623, 4: 3601, 3: 881, 2: 353, 1: 1201 },
    },
    {
      day: '2026-06-18',
      distribution: { 5: 21190, 4: 3671, 3: 903, 2: 365, 1: 1243 },
    },
    {
      day: '2026-06-25',
      distribution: { 5: 21215, 4: 3673, 3: 904, 2: 365, 1: 1243 },
    },
  ],
};

/** Computes total + weighted average from a {1..5: count} distribution. */
function fromDistribution(dist) {
  let total = 0;
  let weighted = 0;
  for (let star = 1; star <= 5; star += 1) {
    const n = dist[star] || 0;
    total += n;
    weighted += star * n;
  }
  const average = total > 0 ? Number((weighted / total).toFixed(2)) : null;
  return { total, average };
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Inserts any known manual baselines for this app if they aren't stored yet.
 * Safe to call repeatedly (idempotent).
 */
export async function seedRatingBaselines(appId) {
  const baselines = MANUAL_BASELINES[appId];
  if (!baselines) return;
  for (const b of baselines) {
    if (await hasRatingSnapshot(appId, b.day, 'manual')) continue;
    const { total, average } = fromDistribution(b.distribution);
    await saveRatingSnapshot(appId, {
      day: b.day,
      totalRatings: total,
      averageRating: average,
      distribution: b.distribution,
      source: 'manual',
      scope: 'global',
    });
  }
}

/**
 * Captures today's ratings snapshot from a ratings summary (iTunes aggregate).
 * Deduplicated to one automatic snapshot per day (overwrites if re-run today).
 */
export async function captureRatingSnapshot(appId, summary) {
  if (!summary || summary.totalRatings == null) return null;
  const day = todayUtc();
  await saveRatingSnapshot(appId, {
    day,
    totalRatings: summary.totalRatings,
    averageRating: summary.averageRating ?? null,
    distribution: null, // iTunes doesn't expose a per-star breakdown
    source: 'itunes',
    scope: 'global',
  });
  return day;
}

/** Stores a user-supplied manual snapshot (e.g. a fresh ASC screenshot). */
export async function addManualSnapshot(appId, { day, distribution, totalRatings, averageRating }) {
  let total = totalRatings;
  let average = averageRating;
  if (distribution) {
    const d = fromDistribution(distribution);
    total = total ?? d.total;
    average = average ?? d.average;
  }
  await saveRatingSnapshot(appId, {
    day: day || todayUtc(),
    totalRatings: total ?? null,
    averageRating: average ?? null,
    distribution: distribution || null,
    source: 'manual',
    scope: 'global',
  });
}

/** Deletes a stored snapshot (by day; optionally narrowed to a source). */
export async function removeSnapshot(appId, { day, source = null, scope = 'global' }) {
  return deleteRatingSnapshot(appId, { day, source, scope });
}

function pct(part, whole) {
  return whole > 0 ? Number(((part / whole) * 100).toFixed(1)) : 0;
}

/** Computes the deltas between two snapshots (from → to). */
function diff(from, to) {
  const totalDelta = (to.totalRatings ?? 0) - (from.totalRatings ?? 0);
  const avgDelta =
    to.averageRating != null && from.averageRating != null
      ? Number((to.averageRating - from.averageRating).toFixed(2))
      : null;

  // Implied average of the net-new ratings between the two snapshots.
  let newRatingsAverage = null;
  if (
    totalDelta > 0 &&
    to.averageRating != null &&
    from.averageRating != null &&
    to.totalRatings != null &&
    from.totalRatings != null
  ) {
    const sumTo = to.averageRating * to.totalRatings;
    const sumFrom = from.averageRating * from.totalRatings;
    newRatingsAverage = Number(((sumTo - sumFrom) / totalDelta).toFixed(2));
  }

  const days = Math.max(1, Math.round((Date.parse(to.day) - Date.parse(from.day)) / 86400000));
  return {
    totalDelta,
    totalDeltaPct: pct(totalDelta, from.totalRatings ?? 0),
    avgDelta,
    newRatingsAverage,
    spanDays: days,
    perDay: Number((totalDelta / days).toFixed(1)),
  };
}

/**
 * Period definitions for the "compare against …" rows. Each picks the stored
 * snapshot closest to (latest − offset) days, within a tolerance band, so a
 * period only appears once there's enough history near that point.
 */
const PERIOD_DEFS = [
  { key: 'yesterday', label: 'vs yesterday', offset: 1, tol: 2 },
  { key: 'week', label: 'vs last week', offset: 7, tol: 3 },
  { key: 'month', label: 'vs last month', offset: 30, tol: 12 },
  { key: 'baseline', label: 'vs baseline', offset: null }, // earliest snapshot
];

/** Picks the snapshot nearest (latest − offset) days within ±tol days. */
function pickNear(earlier, latestDay, offset, tol) {
  const targetMs = Date.parse(latestDay) - offset * 86400000;
  const lo = targetMs - tol * 86400000;
  const hi = targetMs + tol * 86400000;
  let best = null;
  let bestDist = Infinity;
  for (const s of earlier) {
    const ms = Date.parse(s.day);
    if (ms < lo || ms > hi) continue;
    const dist = Math.abs(ms - targetMs);
    if (dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }
  return best;
}

/** YYYY-MM-DD for (fromDay − offset days). */
function offsetDay(fromDay, offset) {
  return new Date(Date.parse(fromDay) - offset * 86400000).toISOString().slice(0, 10);
}

/**
 * Builds the per-period comparison rows. Every period in PERIOD_DEFS is always
 * returned; when no snapshot is near its target, `available` is false and a
 * `targetDay` is provided so the UI can show what's still needed.
 */
function buildPeriods(snapshots, latest) {
  const earlier = snapshots.filter((s) => Date.parse(s.day) < Date.parse(latest.day));
  const periods = [];
  const usedDays = new Set();
  for (const def of PERIOD_DEFS) {
    const ref =
      def.offset == null ? earlier[0] : pickNear(earlier, latest.day, def.offset, def.tol);
    const targetDay = def.offset == null ? null : offsetDay(latest.day, def.offset);
    if (!ref || usedDays.has(ref.day)) {
      periods.push({ key: def.key, label: def.label, available: false, targetDay });
      continue;
    }
    usedDays.add(ref.day);
    periods.push({
      key: def.key,
      label: def.label,
      available: true,
      reference: ref,
      targetDay,
      ...diff(ref, latest),
    });
  }
  return periods;
}

/**
 * Builds the ratings-over-time view: the latest snapshot, multiple period
 * comparisons (yesterday / last week / last month / baseline), the most recent
 * star distribution, and the full timeline.
 */
export async function getRatingsComparison(appId, scope = 'global') {
  const snapshots = await getRatingSnapshots(appId, { scope });
  const baseline = await getFirstRatingSnapshot(appId, scope);
  const latest = await getLatestRatingSnapshot(appId, scope);

  // Most recent snapshot that carries a star distribution (for the breakdown).
  const latestWithDist = [...snapshots].reverse().find((s) => s.distribution) || null;

  // Period cards: prefer the star-distribution snapshots (from App Store Connect
  // screenshots) so the totals match the per-star table exactly. The totals-only
  // iTunes auto-snapshots jitter by ±1, which is misleading; only fall back to
  // them when there isn't enough distribution history yet.
  const distSnapshots = snapshots.filter((s) => s.distribution);
  const useDist = latestWithDist && distSnapshots.length > 1;
  const periodSnapshots = useDist ? distSnapshots : snapshots;
  const periodAnchor = useDist ? latestWithDist : latest;
  const periods = periodAnchor ? buildPeriods(periodSnapshots, periodAnchor) : [];

  // Back-compat: baseline → latest comparison.
  const comparison =
    baseline && latest && baseline.day !== latest.day
      ? { baseline, latest, ...diff(baseline, latest) }
      : null;

  // Per-star deltas: only computable between snapshots that both carry a star
  // distribution (those come from ASC screenshots; the iTunes auto-snapshots
  // only have totals). Anchor on the newest distribution snapshot and compare
  // it against earlier distribution snapshots matched to each period.
  const starComparisons = buildStarComparisons(snapshots, latestWithDist);

  return {
    scope,
    baseline,
    latest,
    comparison,
    periods,
    latestWithDist,
    starAnchor: latestWithDist,
    starComparisons,
    snapshots,
  };
}

/** Per-star difference between two distributions (to − from). */
function starDiff(from, to) {
  const per = {};
  let total = 0;
  for (let star = 1; star <= 5; star += 1) {
    const d = (to.distribution[star] || 0) - (from.distribution[star] || 0);
    per[star] = d;
    total += d;
  }
  const days = Math.max(1, Math.round((Date.parse(to.day) - Date.parse(from.day)) / 86400000));
  return { perStar: per, total, spanDays: days };
}

/**
 * Builds per-star comparison rows (yesterday / last week / last month /
 * baseline) anchored on the newest distribution snapshot.
 */
function buildStarComparisons(snapshots, anchor) {
  if (!anchor || !anchor.distribution) return [];
  const distSnaps = snapshots.filter(
    (s) => s.distribution && Date.parse(s.day) < Date.parse(anchor.day)
  );
  if (!distSnaps.length) return [];

  const rows = [];
  const usedDays = new Set();
  for (const def of PERIOD_DEFS) {
    const ref =
      def.offset == null
        ? distSnaps[0]
        : pickNear(distSnaps, anchor.day, def.offset, def.tol);
    if (!ref || usedDays.has(ref.day)) continue;
    usedDays.add(ref.day);
    rows.push({ key: def.key, label: def.label, reference: ref, ...starDiff(ref, anchor) });
  }
  return rows;
}
