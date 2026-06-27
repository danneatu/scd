import cron from 'node-cron';
import { runDailyJob } from './dailyJob.js';
import { notifyConfigured } from './notify.js';

let task = null;

/**
 * Starts the daily review sync using node-cron.
 *
 * Skipped entirely when DISABLE_CRON=1 — use that on hosts where an external
 * scheduler (e.g. GitHub Actions) runs the job instead, so it doesn't run twice.
 *
 * @param {object} options
 * @param {string} options.appId
 * @param {string} [options.schedule] Cron expression (default 06:00 daily).
 */
export function startScheduler({ appId, schedule = process.env.SYNC_CRON || '0 6 * * *' } = {}) {
  if (process.env.DISABLE_CRON === '1') {
    console.log('[scheduler] DISABLE_CRON=1 — in-process daily sync not started.');
    return null;
  }
  if (!appId) {
    console.warn('[scheduler] No appId; daily sync not started.');
    return null;
  }
  if (!cron.validate(schedule)) {
    console.warn(`[scheduler] Invalid cron expression "${schedule}"; daily sync not started.`);
    return null;
  }

  task = cron.schedule(schedule, async () => {
    const startedAt = new Date().toISOString();
    try {
      await runDailyJob({ appId });
    } catch (err) {
      console.error(`[scheduler] ${startedAt} daily job failed:`, err.message);
    }
  });

  console.log(`[scheduler] Daily sync scheduled ("${schedule}") for app ${appId}.`);
  if (notifyConfigured()) console.log('[scheduler] Email notifications for new written reviews: ON.');
  return task;
}

export function stopScheduler() {
  if (task) {
    task.stop();
    task = null;
  }
}
