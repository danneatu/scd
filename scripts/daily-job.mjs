// CLI entry point for the daily job — used by external schedulers (e.g. GitHub
// Actions) so the cron + LLM features run for free without an always-on server.
//
// Usage:
//   node scripts/daily-job.mjs            # uses APP_ID (or the default)
//   APP_ID=1181860241 node scripts/daily-job.mjs
//
// Exits 0 on success, 1 on a fatal error (individual steps degrade gracefully).

import 'dotenv/config';
import { runDailyJob } from '../src/dailyJob.js';
import { dbDriver } from '../src/db.js';

const appId = process.env.APP_ID || '1181860241';

async function main() {
  console.log(`[daily] start ${new Date().toISOString()} — app ${appId}, store ${dbDriver()}`);
  const result = await runDailyJob({ appId });
  console.log('[daily] done:', JSON.stringify(result));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[daily] fatal:', err);
    process.exit(1);
  });
