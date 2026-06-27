// SQLite data store (local/default driver).
//
// Wraps the synchronous node:sqlite engine behind an async interface so it is
// interchangeable with the Postgres store. The methods are `async` only to
// match that shared contract — internally they run synchronously.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreText } from '../sentiment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH =
  process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'reviews.db');

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

export function createStore() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id               TEXT PRIMARY KEY,
      appId            TEXT NOT NULL,
      rating           INTEGER,
      title            TEXT,
      body             TEXT,
      reviewerNickname TEXT,
      createdDate      TEXT,
      territory        TEXT,
      sentimentScore   REAL,
      sentimentLabel   TEXT,
      responded        INTEGER DEFAULT 0,
      responseBody     TEXT,
      responseDate     TEXT,
      fetchedAt        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_app_date ON reviews (appId, createdDate);

    CREATE TABLE IF NOT EXISTS sync_log (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      appId     TEXT NOT NULL,
      ranAt     TEXT NOT NULL,
      fetched   INTEGER NOT NULL,
      inserted  INTEGER NOT NULL,
      kind      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      appId     TEXT NOT NULL,
      month     TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      source    TEXT NOT NULL,
      json      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reports_app_month ON reports (appId, month);

    CREATE TABLE IF NOT EXISTS rating_snapshots (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      appId         TEXT NOT NULL,
      day           TEXT NOT NULL,
      capturedAt    TEXT NOT NULL,
      totalRatings  INTEGER,
      averageRating REAL,
      distribution  TEXT,
      source        TEXT NOT NULL,
      scope         TEXT NOT NULL DEFAULT 'global'
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rating_snap_unique
      ON rating_snapshots (appId, day, source, scope);

    CREATE TABLE IF NOT EXISTS app_state (
      key       TEXT PRIMARY KEY,
      value     TEXT,
      updatedAt TEXT NOT NULL
    );
  `);

  // Migrate older databases that predate the developer-response columns.
  const reviewCols = new Set(
    db.prepare('PRAGMA table_info(reviews)').all().map((c) => c.name)
  );
  if (!reviewCols.has('responded')) db.exec('ALTER TABLE reviews ADD COLUMN responded INTEGER DEFAULT 0');
  if (!reviewCols.has('responseBody')) db.exec('ALTER TABLE reviews ADD COLUMN responseBody TEXT');
  if (!reviewCols.has('responseDate')) db.exec('ALTER TABLE reviews ADD COLUMN responseDate TEXT');

  return {
    driver: 'sqlite',

    async getState(key) {
      const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key);
      return row?.value ?? null;
    },

    async setState(key, value) {
      db.prepare(
        `INSERT INTO app_state (key, value, updatedAt) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`
      ).run(key, value == null ? null : String(value), new Date().toISOString());
    },

    async getWrittenReviewsSince(appId, sinceIso, limit = 50) {
      return db
        .prepare(
          `SELECT * FROM reviews
           WHERE appId = ? AND createdDate > ?
             AND body IS NOT NULL AND TRIM(body) <> ''
           ORDER BY createdDate DESC
           LIMIT ?`
        )
        .all(appId, sinceIso, limit);
    },

    async getRecentWrittenReviews(appId, limit = 5) {
      return db
        .prepare(
          `SELECT * FROM reviews
           WHERE appId = ? AND body IS NOT NULL AND TRIM(body) <> ''
           ORDER BY createdDate DESC
           LIMIT ?`
        )
        .all(appId, limit);
    },

    async upsertReviews(appId, reviews) {
      const now = new Date().toISOString();
      const existing = db.prepare('SELECT id FROM reviews WHERE id = ?');
      const insert = db.prepare(`
        INSERT INTO reviews
          (id, appId, rating, title, body, reviewerNickname, createdDate, territory, sentimentScore, sentimentLabel, responded, responseBody, responseDate, fetchedAt)
        VALUES
          (@id, @appId, @rating, @title, @body, @reviewerNickname, @createdDate, @territory, @sentimentScore, @sentimentLabel, @responded, @responseBody, @responseDate, @fetchedAt)
        ON CONFLICT(id) DO UPDATE SET
          rating = excluded.rating,
          title = excluded.title,
          body = excluded.body,
          territory = excluded.territory,
          sentimentScore = excluded.sentimentScore,
          sentimentLabel = excluded.sentimentLabel,
          responded = excluded.responded,
          responseBody = excluded.responseBody,
          responseDate = excluded.responseDate
      `);

      let inserted = 0;
      db.exec('BEGIN');
      try {
        for (const r of reviews) {
          const isNew = !existing.get(r.id);
          const text = `${r.title || ''} ${r.body || ''}`.trim();
          const sentiment = scoreText(text);
          insert.run({
            id: r.id,
            appId,
            rating: r.rating ?? null,
            title: r.title ?? '',
            body: r.body ?? '',
            reviewerNickname: r.reviewerNickname ?? '',
            createdDate: r.createdDate ?? null,
            territory: r.territory ?? null,
            sentimentScore: sentiment.comparative,
            sentimentLabel: sentiment.label,
            responded: r.responded ? 1 : 0,
            responseBody: r.responseBody ?? null,
            responseDate: r.responseDate ?? null,
            fetchedAt: now,
          });
          if (isNew) inserted += 1;
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return inserted;
    },

    async logSync(appId, { fetched, inserted, kind }) {
      db.prepare(
        'INSERT INTO sync_log (appId, ranAt, fetched, inserted, kind) VALUES (?, ?, ?, ?, ?)'
      ).run(appId, new Date().toISOString(), fetched, inserted, kind);
    },

    async getReviewsBetween(appId, startIso, endIso) {
      return db
        .prepare(
          `SELECT * FROM reviews
           WHERE appId = ? AND createdDate >= ? AND createdDate <= ?
           ORDER BY createdDate DESC`
        )
        .all(appId, startIso, endIso);
    },

    async getAllReviews(appId, limit = 100000) {
      return db
        .prepare('SELECT * FROM reviews WHERE appId = ? ORDER BY createdDate DESC LIMIT ?')
        .all(appId, limit);
    },

    async getRecentSyncs(appId, limit = 5) {
      return db
        .prepare('SELECT * FROM sync_log WHERE appId = ? ORDER BY ranAt DESC LIMIT ?')
        .all(appId, limit);
    },

    async getLatestReviewDate(appId) {
      const row = db
        .prepare('SELECT MAX(createdDate) AS latest FROM reviews WHERE appId = ?')
        .get(appId);
      return row?.latest ?? null;
    },

    async saveReport(appId, month, source, report) {
      db.prepare(
        'INSERT INTO reports (appId, month, createdAt, source, json) VALUES (?, ?, ?, ?, ?)'
      ).run(appId, month, new Date().toISOString(), source, JSON.stringify(report));
    },

    async getLatestReport(appId, month) {
      const row = db
        .prepare('SELECT * FROM reports WHERE appId = ? AND month = ? ORDER BY createdAt DESC LIMIT 1')
        .get(appId, month);
      if (!row) return null;
      return { ...row, report: JSON.parse(row.json) };
    },

    async saveRatingSnapshot(
      appId,
      { day, totalRatings, averageRating, distribution = null, source, scope = 'global' }
    ) {
      db.prepare(
        `INSERT INTO rating_snapshots
           (appId, day, capturedAt, totalRatings, averageRating, distribution, source, scope)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(appId, day, source, scope) DO UPDATE SET
           capturedAt = excluded.capturedAt,
           totalRatings = excluded.totalRatings,
           averageRating = excluded.averageRating,
           distribution = excluded.distribution`
      ).run(
        appId,
        day,
        new Date().toISOString(),
        totalRatings ?? null,
        averageRating ?? null,
        distribution ? JSON.stringify(distribution) : null,
        source,
        scope
      );
    },

    async getRatingSnapshots(appId, { scope = 'global', limit = 1000 } = {}) {
      return db
        .prepare(
          `SELECT * FROM rating_snapshots
           WHERE appId = ? AND scope = ?
           ORDER BY day ASC, capturedAt ASC
           LIMIT ?`
        )
        .all(appId, scope, limit)
        .map(rowToSnapshot);
    },

    async getFirstRatingSnapshot(appId, scope = 'global') {
      const row = db
        .prepare(
          `SELECT * FROM rating_snapshots WHERE appId = ? AND scope = ?
           ORDER BY day ASC, capturedAt ASC LIMIT 1`
        )
        .get(appId, scope);
      return rowToSnapshot(row);
    },

    async getLatestRatingSnapshot(appId, scope = 'global') {
      const row = db
        .prepare(
          `SELECT * FROM rating_snapshots WHERE appId = ? AND scope = ?
           ORDER BY day DESC, capturedAt DESC LIMIT 1`
        )
        .get(appId, scope);
      return rowToSnapshot(row);
    },

    async hasRatingSnapshot(appId, day, source, scope = 'global') {
      const row = db
        .prepare(
          'SELECT 1 FROM rating_snapshots WHERE appId = ? AND day = ? AND source = ? AND scope = ? LIMIT 1'
        )
        .get(appId, day, source, scope);
      return !!row;
    },
  };
}
