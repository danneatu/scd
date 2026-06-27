-- Schema for the App Ratings Analyzer (Postgres / Supabase).
--
-- The app also self-initializes these tables on first connect, so applying this
-- migration is optional — it's provided for Supabase's migration workflow and
-- so the schema is reviewable in version control.
--
-- Column names are lowercase (Postgres folds unquoted identifiers); the app
-- aliases them back to camelCase in its SELECTs.

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
