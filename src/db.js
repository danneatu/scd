// Data-layer facade.
//
// Exposes one async API backed by either SQLite (local/default) or Postgres
// (production, e.g. Supabase). The driver is chosen once at startup:
//
//   DB_DRIVER=sqlite                  -> node:sqlite  (default)
//   DB_DRIVER=postgres + DATABASE_URL -> Postgres
//   (DATABASE_URL set, no DB_DRIVER)  -> Postgres (auto)
//
// The store module is imported lazily so the unused driver's dependency
// (`pg` or `node:sqlite`) is never loaded.

const DRIVER = (
  process.env.DB_DRIVER || (process.env.DATABASE_URL ? 'postgres' : 'sqlite')
).toLowerCase();

let storePromise;

async function store() {
  if (!storePromise) {
    storePromise =
      DRIVER === 'postgres'
        ? import('./db/pgStore.js').then((m) => m.createStore())
        : import('./db/sqliteStore.js').then((m) => m.createStore());
  }
  return storePromise;
}

/** The active driver name ("sqlite" | "postgres"). */
export function dbDriver() {
  return DRIVER;
}

/** Eagerly initializes the store (and verifies connectivity). */
export async function initDb() {
  return store();
}

/* ---------- key/value app state ---------- */
export async function getState(key) {
  return (await store()).getState(key);
}
export async function setState(key, value) {
  return (await store()).setState(key, value);
}

/* ---------- reviews ---------- */
export async function getWrittenReviewsSince(appId, sinceIso, limit = 50) {
  return (await store()).getWrittenReviewsSince(appId, sinceIso, limit);
}
export async function getRecentWrittenReviews(appId, limit = 5) {
  return (await store()).getRecentWrittenReviews(appId, limit);
}
export async function upsertReviews(appId, reviews) {
  return (await store()).upsertReviews(appId, reviews);
}
export async function getReviewsBetween(appId, startIso, endIso) {
  return (await store()).getReviewsBetween(appId, startIso, endIso);
}
export async function getAllReviews(appId, limit = 100000) {
  return (await store()).getAllReviews(appId, limit);
}
export async function getLatestReviewDate(appId) {
  return (await store()).getLatestReviewDate(appId);
}

/* ---------- sync log ---------- */
export async function logSync(appId, opts) {
  return (await store()).logSync(appId, opts);
}
export async function getRecentSyncs(appId, limit = 5) {
  return (await store()).getRecentSyncs(appId, limit);
}

/* ---------- reports ---------- */
export async function saveReport(appId, month, source, report) {
  return (await store()).saveReport(appId, month, source, report);
}
export async function getLatestReport(appId, month) {
  return (await store()).getLatestReport(appId, month);
}

/* ---------- rating snapshots ---------- */
export async function saveRatingSnapshot(appId, snapshot) {
  return (await store()).saveRatingSnapshot(appId, snapshot);
}
export async function getRatingSnapshots(appId, opts = {}) {
  return (await store()).getRatingSnapshots(appId, opts);
}
export async function getFirstRatingSnapshot(appId, scope = 'global') {
  return (await store()).getFirstRatingSnapshot(appId, scope);
}
export async function getLatestRatingSnapshot(appId, scope = 'global') {
  return (await store()).getLatestRatingSnapshot(appId, scope);
}
export async function hasRatingSnapshot(appId, day, source, scope = 'global') {
  return (await store()).hasRatingSnapshot(appId, day, source, scope);
}
