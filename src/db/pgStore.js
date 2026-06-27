// Postgres data store (production driver, e.g. Supabase).
//
// Mirrors the SQLite store's interface exactly, so the rest of the app is
// storage-agnostic. Postgres folds unquoted identifiers to lowercase, so every
// SELECT aliases columns back to the camelCase names the app expects.
//
// Activated when DB_DRIVER=postgres (or a DATABASE_URL is present). Connection
// string + SSL come from env:
//   DATABASE_URL   e.g. postgresql://postgres:<pw>@<host>:5432/postgres
//   DATABASE_SSL   "false" to disable TLS (default: on for non-localhost hosts)

import pg from 'pg';
import { scoreText } from '../sentiment.js';

const { Pool } = pg;

// Explicit column lists that re-alias to camelCase (avoids `SELECT *`).
const REVIEW_COLS = `
  id, appid AS "appId", rating, title, body,
  reviewernickname AS "reviewerNickname", createddate AS "createdDate",
  territory, sentimentscore AS "sentimentScore", sentimentlabel AS "sentimentLabel",
  responded, responsebody AS "responseBody", responsedate AS "responseDate",
  fetchedat AS "fetchedAt"`;

const SNAP_COLS = `
  id, appid AS "appId", day, capturedat AS "capturedAt",
  totalratings AS "totalRatings", averagerating AS "averageRating",
  distribution, source, scope`;

const REPORT_COLS = `
  id, appid AS "appId", month, createdat AS "createdAt", source, json`;

const SYNC_COLS = `
  id, appid AS "appId", ranat AS "ranAt", fetched, inserted, kind`;

function rowToSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
    appId: row.appId,
    day: row.day,
    capturedAt: row.capturedAt,
    totalRatings: row.totalRatings,
    averageRating: row.averageRating,
    distribution: row.distribution ? JSON.parse(row.distribution) : null,
    source: row.source,
    scope: row.scope,
  };
}

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id               TEXT PRIMARY KEY,
      appid            TEXT NOT NULL,
      rating           INTEGER,
      title            TEXT,
      body             TEXT,
      reviewernickname TEXT,
      createddate      TEXT,
      territory        TEXT,
      sentimentscore   DOUBLE PRECISION,
      sentimentlabel   TEXT,
      responded        INTEGER DEFAULT 0,
      responsebody     TEXT,
      responsedate     TEXT,
      fetchedat        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_app_date ON reviews (appid, createddate);

    CREATE TABLE IF NOT EXISTS sync_log (
      id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      appid     TEXT NOT NULL,
      ranat     TEXT NOT NULL,
      fetched   INTEGER NOT NULL,
      inserted  INTEGER NOT NULL,
      kind      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      appid     TEXT NOT NULL,
      month     TEXT NOT NULL,
      createdat TEXT NOT NULL,
      source    TEXT NOT NULL,
      json      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reports_app_month ON reports (appid, month);

    CREATE TABLE IF NOT EXISTS rating_snapshots (
      id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      appid         TEXT NOT NULL,
      day           TEXT NOT NULL,
      capturedat    TEXT NOT NULL,
      totalratings  INTEGER,
      averagerating DOUBLE PRECISION,
      distribution  TEXT,
      source        TEXT NOT NULL,
      scope         TEXT NOT NULL DEFAULT 'global'
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rating_snap_unique
      ON rating_snapshots (appid, day, source, scope);

    CREATE TABLE IF NOT EXISTS app_state (
      key       TEXT PRIMARY KEY,
      value     TEXT,
      updatedat TEXT NOT NULL
    );
  `);
}

export async function createStore() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DB_DRIVER=postgres requires a DATABASE_URL connection string.');
  }

  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
  const sslDisabled = process.env.DATABASE_SSL === 'false' || isLocal;
  const pool = new Pool({
    connectionString,
    ssl: sslDisabled ? false : { rejectUnauthorized: false },
    max: Number(process.env.DATABASE_POOL_MAX || 10),
  });

  await ensureSchema(pool);

  const one = async (text, params) => (await pool.query(text, params)).rows[0] ?? null;
  const many = async (text, params) => (await pool.query(text, params)).rows;

  return {
    driver: 'postgres',
    pool,

    async getState(key) {
      const row = await one('SELECT value FROM app_state WHERE key = $1', [key]);
      return row?.value ?? null;
    },

    async setState(key, value) {
      await pool.query(
        `INSERT INTO app_state (key, value, updatedat) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updatedat = excluded.updatedat`,
        [key, value == null ? null : String(value), new Date().toISOString()]
      );
    },

    async getWrittenReviewsSince(appId, sinceIso, limit = 50) {
      return many(
        `SELECT ${REVIEW_COLS} FROM reviews
         WHERE appid = $1 AND createddate > $2
           AND body IS NOT NULL AND TRIM(body) <> ''
         ORDER BY createddate DESC
         LIMIT $3`,
        [appId, sinceIso, limit]
      );
    },

    async getRecentWrittenReviews(appId, limit = 5) {
      return many(
        `SELECT ${REVIEW_COLS} FROM reviews
         WHERE appid = $1 AND body IS NOT NULL AND TRIM(body) <> ''
         ORDER BY createddate DESC
         LIMIT $2`,
        [appId, limit]
      );
    },

    async upsertReviews(appId, reviews) {
      const now = new Date().toISOString();
      const client = await pool.connect();
      let inserted = 0;
      try {
        await client.query('BEGIN');
        for (const r of reviews) {
          const text = `${r.title || ''} ${r.body || ''}`.trim();
          const sentiment = scoreText(text);
          const res = await client.query(
            `INSERT INTO reviews
               (id, appid, rating, title, body, reviewernickname, createddate, territory,
                sentimentscore, sentimentlabel, responded, responsebody, responsedate, fetchedat)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             ON CONFLICT (id) DO UPDATE SET
               rating = excluded.rating,
               title = excluded.title,
               body = excluded.body,
               territory = excluded.territory,
               sentimentscore = excluded.sentimentscore,
               sentimentlabel = excluded.sentimentlabel,
               responded = excluded.responded,
               responsebody = excluded.responsebody,
               responsedate = excluded.responsedate
             RETURNING (xmax = 0) AS inserted`,
            [
              r.id,
              appId,
              r.rating ?? null,
              r.title ?? '',
              r.body ?? '',
              r.reviewerNickname ?? '',
              r.createdDate ?? null,
              r.territory ?? null,
              sentiment.comparative,
              sentiment.label,
              r.responded ? 1 : 0,
              r.responseBody ?? null,
              r.responseDate ?? null,
              now,
            ]
          );
          if (res.rows[0]?.inserted) inserted += 1;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      return inserted;
    },

    async logSync(appId, { fetched, inserted, kind }) {
      await pool.query(
        'INSERT INTO sync_log (appid, ranat, fetched, inserted, kind) VALUES ($1, $2, $3, $4, $5)',
        [appId, new Date().toISOString(), fetched, inserted, kind]
      );
    },

    async getReviewsBetween(appId, startIso, endIso) {
      return many(
        `SELECT ${REVIEW_COLS} FROM reviews
         WHERE appid = $1 AND createddate >= $2 AND createddate <= $3
         ORDER BY createddate DESC`,
        [appId, startIso, endIso]
      );
    },

    async getAllReviews(appId, limit = 100000) {
      return many(
        `SELECT ${REVIEW_COLS} FROM reviews WHERE appid = $1 ORDER BY createddate DESC LIMIT $2`,
        [appId, limit]
      );
    },

    async getRecentSyncs(appId, limit = 5) {
      return many(
        `SELECT ${SYNC_COLS} FROM sync_log WHERE appid = $1 ORDER BY ranat DESC LIMIT $2`,
        [appId, limit]
      );
    },

    async getLatestReviewDate(appId) {
      const row = await one(
        'SELECT MAX(createddate) AS latest FROM reviews WHERE appid = $1',
        [appId]
      );
      return row?.latest ?? null;
    },

    async saveReport(appId, month, source, report) {
      await pool.query(
        'INSERT INTO reports (appid, month, createdat, source, json) VALUES ($1, $2, $3, $4, $5)',
        [appId, month, new Date().toISOString(), source, JSON.stringify(report)]
      );
    },

    async getLatestReport(appId, month) {
      const row = await one(
        `SELECT ${REPORT_COLS} FROM reports WHERE appid = $1 AND month = $2
         ORDER BY createdat DESC LIMIT 1`,
        [appId, month]
      );
      if (!row) return null;
      return { ...row, report: JSON.parse(row.json) };
    },

    async saveRatingSnapshot(
      appId,
      { day, totalRatings, averageRating, distribution = null, source, scope = 'global' }
    ) {
      await pool.query(
        `INSERT INTO rating_snapshots
           (appid, day, capturedat, totalratings, averagerating, distribution, source, scope)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (appid, day, source, scope) DO UPDATE SET
           capturedat = excluded.capturedat,
           totalratings = excluded.totalratings,
           averagerating = excluded.averagerating,
           distribution = excluded.distribution`,
        [
          appId,
          day,
          new Date().toISOString(),
          totalRatings ?? null,
          averageRating ?? null,
          distribution ? JSON.stringify(distribution) : null,
          source,
          scope,
        ]
      );
    },

    async getRatingSnapshots(appId, { scope = 'global', limit = 1000 } = {}) {
      const rows = await many(
        `SELECT ${SNAP_COLS} FROM rating_snapshots
         WHERE appid = $1 AND scope = $2
         ORDER BY day ASC, capturedat ASC
         LIMIT $3`,
        [appId, scope, limit]
      );
      return rows.map(rowToSnapshot);
    },

    async getFirstRatingSnapshot(appId, scope = 'global') {
      const row = await one(
        `SELECT ${SNAP_COLS} FROM rating_snapshots WHERE appid = $1 AND scope = $2
         ORDER BY day ASC, capturedat ASC LIMIT 1`,
        [appId, scope]
      );
      return rowToSnapshot(row);
    },

    async getLatestRatingSnapshot(appId, scope = 'global') {
      const row = await one(
        `SELECT ${SNAP_COLS} FROM rating_snapshots WHERE appid = $1 AND scope = $2
         ORDER BY day DESC, capturedat DESC LIMIT 1`,
        [appId, scope]
      );
      return rowToSnapshot(row);
    },

    async hasRatingSnapshot(appId, day, source, scope = 'global') {
      const row = await one(
        'SELECT 1 FROM rating_snapshots WHERE appid = $1 AND day = $2 AND source = $3 AND scope = $4 LIMIT 1',
        [appId, day, source, scope]
      );
      return !!row;
    },
  };
}
