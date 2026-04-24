const cron = require('node-cron');
const mongoose = require('mongoose');
const { fetchStockLevels } = require('../xml/stock');

async function runStockSync() {
  if (mongoose.connection.readyState !== 1) return;
  try {
    const items = await fetchStockLevels();
    if (!items || items.length === 0) return;

    const db = mongoose.connection.db;
    let updated = 0;

    for (const item of items) {
      const result = await db.collection('products').updateOne(
        { item: { $regex: new RegExp(`^${item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
        { $set: { stockqty: Math.max(0, item.closingQty), tallyRate: item.rate, lastStockSync: new Date() } }
      );
      if (result.matchedCount > 0) updated++;
    }

    console.log(`[StockSync] Updated ${updated}/${items.length} products from Tally stock`);
  } catch (err) {
    console.error('[StockSync] Failed:', err.message);
  }
}

function startStockSyncJob() {
  // Run once after startup (delay to let relay connect)
  setTimeout(runStockSync, 30_000);

  // Every 30 minutes
  cron.schedule('*/30 * * * *', runStockSync);
  console.log('[StockSync] Scheduled: every 30 min');
}

module.exports = { startStockSyncJob, runStockSync };
