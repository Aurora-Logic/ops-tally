const mongoose = require('mongoose');

// Collection name for raw Tally events — no model needed, raw inserts
const EVENTS_COLLECTION = 'tally_events';

/**
 * Handle a webhook push from TDL running inside Tally Prime.
 * Body shape (JSON):
 *   { voucherType, party, amount, voucherNo, date, narration }
 *
 * We:
 *  1. Persist the raw event (audit trail)
 *  2. For Receipt vouchers — find matching dealer + mark latest payment
 *  3. For Sales/Sales Invoice — find matching order by refId in narration
 */
async function handleTallyWebhook(body) {
  const { voucherType, party, amount, voucherNo, date, narration } = body;

  if (!voucherType || !party) {
    return { ok: false, error: 'Missing voucherType or party' };
  }

  const db = mongoose.connection.db;
  const now = new Date();

  // 1. Persist raw event
  const event = {
    voucherType,
    party,
    amount: parseFloat(amount) || 0,
    voucherNo: voucherNo || '',
    date: date || '',
    narration: narration || '',
    receivedAt: now,
  };
  await db.collection(EVENTS_COLLECTION).insertOne(event);

  let action = 'logged';

  // 2. Receipt voucher → record payment against dealer
  if (voucherType === 'Receipt') {
    const result = await db.collection('dealers').updateOne(
      { dealer_name: { $regex: new RegExp(`^${escapeRegex(party)}$`, 'i') } },
      {
        $set: {
          lastTallyPayment: {
            amount: parseFloat(amount) || 0,
            voucherNo,
            date,
            receivedAt: now,
          },
        },
      }
    );
    if (result.matchedCount > 0) action = 'payment_recorded';
  }

  // 3. Sales Invoice → stamp tally invoice number on order
  // TDL narration should contain the OPS refId (we set it as narration when pushing sales order)
  if (voucherType === 'Sales' || voucherType === 'Sales Invoice') {
    if (narration) {
      // narration may contain the refId we sent, e.g. "OPS-REF:64abc123..."
      const refMatch = narration.match(/OPS-REF:([a-f0-9]{24})/i);
      if (refMatch) {
        const refId = refMatch[1];
        await db.collection('updatedorderhistories').updateOne(
          { 'orders._id': new mongoose.Types.ObjectId(refId) },
          { $set: { 'orders.$.tallyInvoiceNo': voucherNo, 'orders.$.tallyInvoicedAt': now } }
        );
        action = 'order_invoiced';
      }
    }
  }

  return { ok: true, action, voucherType, party };
}

async function getTallyEvents(limit = 50) {
  const db = mongoose.connection.db;
  const events = await db
    .collection(EVENTS_COLLECTION)
    .find({})
    .sort({ receivedAt: -1 })
    .limit(limit)
    .toArray();
  return events;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { handleTallyWebhook, getTallyEvents };
