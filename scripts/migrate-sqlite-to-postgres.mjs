// One-time migration: copy a local SQLite reviews.db into Postgres (Supabase).
//
// Usage (from the project root):
//   DATABASE_URL="postgresql://postgres:<pw>@<host>:5432/postgres" \
//     node scripts/migrate-sqlite-to-postgres.mjs
//
// Optional:
//   DB_PATH=./data/reviews.db   path to the source SQLite file (default)
//   DATABASE_SSL=false          disable TLS (default on for non-localhost)
//
// Safe to re-run: rows are inserted with ON CONFLICT DO NOTHING (app_state is
// upserted), so existing Postgres data is preserved.

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../src/db/pgStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQLITE_PATH =
  process.env.DB_PATH || path.join(__dirname, '..', 'data', 'reviews.db');

function readAll(db, table) {
  return db.prepare(`SELECT * FROM ${table}`).all();
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: set DATABASE_URL to your Postgres/Supabase connection string.');
    process.exit(1);
  }

  console.log(`Source SQLite : ${SQLITE_PATH}`);
  const sqlite = new DatabaseSync(SQLITE_PATH, { readOnly: true });

  // Creating the Postgres store also runs the schema DDL (idempotent).
  const store = await createStore();
  const { pool } = store;
  console.log('Connected to Postgres and ensured schema.\n');

  let totals = {};

  // ---- reviews ----
  {
    const rows = readAll(sqlite, 'reviews');
    let n = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const r of rows) {
        const res = await client.query(
          `INSERT INTO reviews
             (id, appid, rating, title, body, reviewernickname, createddate, territory,
              sentimentscore, sentimentlabel, responded, responsebody, responsedate, fetchedat)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (id) DO NOTHING`,
          [
            r.id, r.appId, r.rating, r.title, r.body, r.reviewerNickname,
            r.createdDate, r.territory, r.sentimentScore, r.sentimentLabel,
            r.responded ?? 0, r.responseBody ?? null, r.responseDate ?? null, r.fetchedAt,
          ]
        );
        n += res.rowCount;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    totals.reviews = `${n} inserted / ${rows.length} read`;
  }

  // ---- sync_log ----
  {
    const rows = readAll(sqlite, 'sync_log');
    let n = 0;
    for (const r of rows) {
      const res = await pool.query(
        `INSERT INTO sync_log (appid, ranat, fetched, inserted, kind)
         VALUES ($1,$2,$3,$4,$5)`,
        [r.appId, r.ranAt, r.fetched, r.inserted, r.kind]
      );
      n += res.rowCount;
    }
    totals.sync_log = `${n} inserted / ${rows.length} read`;
  }

  // ---- reports ----
  {
    const rows = readAll(sqlite, 'reports');
    let n = 0;
    for (const r of rows) {
      const res = await pool.query(
        `INSERT INTO reports (appid, month, createdat, source, json)
         VALUES ($1,$2,$3,$4,$5)`,
        [r.appId, r.month, r.createdAt, r.source, r.json]
      );
      n += res.rowCount;
    }
    totals.reports = `${n} inserted / ${rows.length} read`;
  }

  // ---- rating_snapshots ----
  {
    const rows = readAll(sqlite, 'rating_snapshots');
    let n = 0;
    for (const r of rows) {
      const res = await pool.query(
        `INSERT INTO rating_snapshots
           (appid, day, capturedat, totalratings, averagerating, distribution, source, scope)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (appid, day, source, scope) DO NOTHING`,
        [
          r.appId, r.day, r.capturedAt, r.totalRatings, r.averageRating,
          r.distribution ?? null, r.source, r.scope,
        ]
      );
      n += res.rowCount;
    }
    totals.rating_snapshots = `${n} inserted / ${rows.length} read`;
  }

  // ---- app_state ----
  {
    const rows = readAll(sqlite, 'app_state');
    let n = 0;
    for (const r of rows) {
      const res = await pool.query(
        `INSERT INTO app_state (key, value, updatedat)
         VALUES ($1,$2,$3)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updatedat = excluded.updatedat`,
        [r.key, r.value, r.updatedAt]
      );
      n += res.rowCount;
    }
    totals.app_state = `${n} upserted / ${rows.length} read`;
  }

  sqlite.close();
  await pool.end();

  console.log('Migration complete:');
  for (const [table, summary] of Object.entries(totals)) {
    console.log(`  ${table.padEnd(16)} ${summary}`);
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
