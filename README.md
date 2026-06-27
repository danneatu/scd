# App Ratings Analyzer

A small web app that pulls an app's customer reviews from the
[App Store Connect API](https://developer.apple.com/documentation/appstoreconnectapi),
stores them locally, and turns them into a **monthly dashboard** with an
AI/heuristic **"biggest pain points vs. what users love"** report.

It paginates through `GET /v1/apps/{id}/customerReviews` with
`sort=-createdDate`. JWT (ES256) authentication is handled **server-side**, so
your private key never touches the browser.

Default app ID: **1181860241**.

## What it does

- **Daily auto-sync** — a `node-cron` job pulls the latest reviews once a day
  (default 06:00) and upserts them into a local SQLite database (deduped by
  review id). You can also click **"Sync today's reviews"** anytime.
- **Monthly dashboard** — pick a month and see counts, average rating, sentiment
  split, and last-sync info, all served from the local DB.
- **Monthly insights ("agent")** — click **"Analyze this month"** to get a
  summary of the **biggest pain points** and **what users are most satisfied
  with**, grouped into themes with example quotes. Uses an LLM when configured,
  otherwise a free, fully-local heuristic.

## How it works

```
                ┌──────────────────────────────────────────────┐
 daily 06:00 ──►│  Node/Express  ──►  App Store Connect API     │
 "Sync now"  ──►│      │              GET /v1/apps/{id}/reviews │
                │      ▼                                        │
                │  SQLite (data/reviews.db)  ◄── dedup by id    │
                │      │                                        │
 "Analyze"  ───►│      └─►  Insights agent  ──►  pain/praise    │
 Dashboard  ◄───│           (LLM or local heuristic)            │
                └──────────────────────────────────────────────┘
```

- [server.js](server.js) — Express server + API endpoints, starts the scheduler.
- [src/appStoreClient.js](src/appStoreClient.js) — JWT generation + paginated fetching (incl. `fetchReviewsSince`).
- [src/db.js](src/db.js) — SQLite storage (built-in `node:sqlite`), upsert + queries.
- [src/sync.js](src/sync.js) — incremental + windowed sync into the DB.
- [src/scheduler.js](src/scheduler.js) — `node-cron` daily job.
- [src/insights.js](src/insights.js) — the monthly pain-points / praises "agent".
- [src/llm.js](src/llm.js) — optional OpenAI/Anthropic client (graceful fallback).
- [src/analyzer.js](src/analyzer.js) — averages, distribution, monthly trend, keywords, sentiment.
- [src/sentiment.js](src/sentiment.js) — lexicon-based sentiment scoring (no external deps).
- [public/](public) — the frontend (no build step, plain HTML/CSS/JS).

### API endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/config` | Credential / LLM / schedule status. |
| `POST` | `/api/sync` | Incremental pull of the latest reviews into the DB. |
| `GET` | `/api/dashboard?month=YYYY-MM` | Stored dashboard state for a month (`&sync=1` to refresh first). |
| `GET` | `/api/monthly-report?month=YYYY-MM` | Generate/return the pain-points report (`&refresh=1` to regenerate). |
| `GET` | `/api/ratings-summary` | All-time ratings & average across storefronts (`&force=1` to refresh). |
| `GET` | `/api/downloads-summary` | Download totals from Sales Reports (`&force=1` to refresh). |
| `GET` | `/api/reviews?max=500` | Ad-hoc live fetch + analysis (no storage). |

## Analysis included

- **Rating distribution** and **average rating**
- **Reviews-by-month** trend
- **Top keywords** — word-frequency cloud over review text (stopwords removed)
- **Sentiment** — heuristic, lexicon-based scoring of the review text (with simple
  negation handling like "not bad"), broken down into positive / neutral / negative
- **Monthly pain points & praises** — themed summary (LLM or local heuristic)
- **Ratings overview** — all-time total ratings & average across storefronts
  (public iTunes data), including the star-only ratings the reviews API omits
- **Downloads** — first-time install counts from Sales Reports (optional; needs a Sales-role key)

## Optional: Downloads via Sales Reports

The written-reviews and ratings data above need no extra setup. **Download
numbers are different** — they come from App Store Connect **Sales Reports**,
which require a separate API key with the **Sales** role (read-only: it cannot
delete the app, change pricing, or access anything else) plus your numeric
**Vendor Number**.

Add to `.env`:

```dotenv
SALES_KEY_ID=XXXXXXXXXX
SALES_PRIVATE_KEY_PATH=./AuthKey_XXXXXXXXXX.p8
SALES_VENDOR_NUMBER=8XXXXXXX        # App Store Connect → Payments and Financial Reports
# DOWNLOADS_START_YEAR=2017         # optional; auto-detected from release date
```

The Issuer ID is account-wide, so `ASC_ISSUER_ID` is reused. The app then shows
all-time / year-to-date / month-to-date / last-30-day downloads and a
per-country breakdown, computed from yearly + monthly + daily reports. Sales
data lags ~1–2 days, so the most recent days may read 0. Results are cached for
6 hours; use **Refresh downloads** to recompute.

> Why a separate key? It keeps your read-light **Customer Support** review key
> untouched, and a Sales key still can't modify or remove the app.

## Optional: AI summarizer

The monthly insights work out of the box with a **local heuristic** (keyword +
sentiment clustering, multilingual EN/DE) — no API key, nothing leaves your
machine. For richer, fluent summaries, add an LLM key to `.env`:

```dotenv
LLM_PROVIDER=openai        # or "anthropic"
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini      # optional
```

The app auto-detects this and upgrades the report; review text is only sent to
your chosen provider when a key is set.

## Prerequisites
````

- Node.js 18+ (uses the built-in `fetch`).
- An App Store Connect **API key** with the **Customer Support** role — the
  least-privilege role that can read customer reviews. See [Security](#security)
  below for why this matters.

## 1. Create an App Store Connect API key

1. Go to [App Store Connect → Users and Access → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/api).
2. Note the **Issuer ID** at the top of the page.
3. Click **+** to generate a new key. Give it a name and, for **Access**, choose
   the **Customer Support** role (not Admin). Then click **Generate**.
4. Note the **Key ID**, and **Download** the `.p8` private key file.
   > You can only download the `.p8` once. Keep it safe.

## 2. Configure

```bash
cp .env.example .env
```

Edit `.env` and fill in:

```dotenv
ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
ASC_KEY_ID=ABCD1234EF
ASC_PRIVATE_KEY_PATH=./AuthKey_ABCD1234EF.p8
APP_ID=1181860241
```

Place the downloaded `.p8` file in the project folder (it's already git-ignored).

## 3. Run

```bash
npm install
npm start
```

Open <http://localhost:3000>, then click **Fetch reviews**.

## Security

The key's powers are defined by the **role** you pick when creating it — not by
this app. Choosing **Customer Support** keeps the blast radius tiny even if the
key ever leaks:

**A Customer Support key CAN:**
- Read customer reviews and ratings.
- Reply to / edit responses to reviews.

**A Customer Support key CANNOT:**
- Delete or remove the app from the App Store.
- Submit, reject, or change app versions, metadata, pricing, or availability.
- Access financial/sales reports, agreements, or banking info.
- Manage users, certificates, provisioning profiles, or other API keys.

Extra reassurances:
- The **Account Holder** role (the only role that can fully manage/remove the
  app) **cannot** be assigned to an API key at all. Avoid **Admin** too, since
  Admin can remove apps from sale.
- This app **only ever makes `GET` requests** — it never writes, deletes, or
  responds to anything. It can't modify your account regardless of the key's role.
- The key is used **server-side only**; your `.p8` private key never reaches the
  browser, and `.env` / `*.p8` are git-ignored.
- You can **revoke** the key instantly anytime from App Store Connect → Users and
  Access → Integrations, which immediately invalidates it.

> Tip: keep this key dedicated to read-only analytics. If you later need write
> access for something else, create a separate key for that purpose.

## Notes & limits

- The `customerReviews` endpoint returns up to **200** reviews per page; the
  server follows the `links.next` cursor until it reaches your "Max reviews"
  value (default 500, capped at 5000).
- Apple only exposes reviews that are available through App Store Connect;
  very old or removed reviews may not be returned.
- You can filter by territory (e.g. `USA`) and change the sort order from the UI.
- Use **Export JSON** to download the raw fetched data + analysis.

## Troubleshooting

| Error | Likely cause |
| --- | --- |
| `401 NOT_AUTHORIZED` | Wrong Issuer ID / Key ID, or the `.p8` doesn't match the Key ID. |
| `403 FORBIDDEN` | The API key's role can't read reviews. Use the **Customer Support** role. |
| `404 NOT_FOUND` | Wrong `APP_ID`, or the key has no access to that app. |
| `Private key file not found` | Check `ASC_PRIVATE_KEY_PATH` in `.env`. |
