const mongoose = require('mongoose');
const { webhookSecret } = require('./config');

const EVENTS_COLLECTION = 'tally_events';

/**
 * Handle a webhook push from TDL running inside Tally Prime.
 * Body shape (JSON):
 *   { voucherType, party, amount, voucherNo, date, narration, secret }
 *
 * Fix 1: Verifies shared secret so only genuine Tally pushes are accepted.
 * Fix 3: Sales Invoice matching now works because salesOrder.js writes OPS-REF in narration.
 */
async function handleTallyWebhook(body) {
  const { voucherType, party, amount, voucherNo, date, narration, secret } = body;

  // Fix 1: reject if secret is configured but doesn't match
  if (webhookSecret && secret !== webhookSecret) {
    console.warn(`[Webhook] Rejected unauthorised push — party: ${party}, type: ${voucherType}`);
    return { ok: false, error: 'Unauthorized', status: 401 };
  }

  if (!voucherType || !party) {
    return { ok: false, error: 'Missing voucherType or party', status: 400 };
  }

  const db = mongoose.connection.db;
  const now = new Date();

  // 1. Persist raw event — also acts as dedup log for the scheduled receipt poll (Fix 6)
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

  // 2. Receipt → record last payment against dealer
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

  // 3. Sales / Sales Invoice → stamp tally invoice number on OPS order
  // Fix 3: works now that salesOrder.js/invoice.js write OPS-REF:<id> into NARRATION
  if (voucherType === 'Sales' || voucherType === 'Sales Invoice') {
    if (narration) {
      const refMatch = narration.match(/OPS-REF:([a-f0-9]{24})/i);
      if (refMatch) {
        const refId = refMatch[1];
        const res = await db.collection('updatedorderhistories').updateOne(
          { 'orders._id': refId },
          { $set: { 'orders.$.tallyInvoiceNo': voucherNo, 'orders.$.tallyInvoicedAt': now } }
        );
        if (res.matchedCount > 0) action = 'order_invoiced';
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
