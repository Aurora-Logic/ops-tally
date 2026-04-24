const cron = require('node-cron');
const { syncCustomersToOPS } = require('../customerSync');

async function runSync() {
  console.log('[CustomerSyncJob] Starting customer sync from Tally...');
  try {
    const result = await syncCustomersToOPS();
    console.log(`[CustomerSyncJob] Done — total: ${result.total}, upserted: ${result.upserted}, errors: ${result.errors}`);
  } catch (err) {
    console.error('[CustomerSyncJob] Sync failed:', err.message);
  }
}

function startCustomerSyncJob() {
  // Run immediately on startup
  runSync();

  // Every 15 minutes, 8am–8pm
  cron.schedule('*/15 8-20 * * *', runSync, { timezone: 'Asia/Kolkata' });
  console.log('[CustomerSyncJob] Scheduled: every 15 min, 08:00–20:00 IST');
}

module.exports = { startCustomerSyncJob };
