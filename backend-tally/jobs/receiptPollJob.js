const cron = require('node-cron');
const mongoose = require('mongoose');
const { XMLParser } = require('fast-xml-parser');
const { sendToTally } = require('../bridge');
const { tallyCompany } = require('../config');

/**
 * Fix 6: TDL fires once and forgets — if the VPS is down when a voucher is saved,
 * that Receipt event is lost. This job polls Tally for Receipt vouchers from the last
 * 24 hours every 6 hours and inserts any that aren't already in tally_events.
 * It's a safety net, not the primary path.
 */

function buildReceiptQueryXML(fromDate, toDate) {
  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          <SVCURRENTCOMPANY>${tallyCompany}</SVCURRENTCOMPANY>
          <SVFROMDATE>${fmt(fromDate)}</SVFROMDATE>
          <SVTODATE>${fmt(toDate)}</SVTODATE>
          <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;
}

async function runReceiptPoll() {
  if (mongoose.connection.readyState !== 1) return;

  try {
    const toDate = new Date();
    const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

    let rawXml;
    try {
      rawXml = await sendToTally(buildReceiptQueryXML(fromDate, toDate));
    } catch {
      return; // relay not connected — skip silently, not an error
    }

    const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
    const parsed = parser.parse(rawXml);

    const rawVouchers = parsed?.ENVELOPE?.BODY?.DATA?.COLLECTION?.VOUCHER || [];
    const vouchers = Array.isArray(rawVouchers) ? rawVouchers : [rawVouchers];

    const db = mongoose.connection.db;
    const EVENTS = 'tally_events';
    let inserted = 0;

    for (const v of vouchers) {
      const voucherNo = v.VOUCHERNUMBER || v.VCHNO || '';
      if (!voucherNo) continue;

      // Skip if already recorded (TDL push may have captured it first)
      const existing = await db.collection(EVENTS).findOne({ voucherNo, voucherType: 'Receipt' });
      if (existing) continue;

      const party = v.PARTYLEDGERNAME || v.PARTYNAME || '';
      const amount = parseFloat(v.AMOUNT || v.LEDGERAMOUNT || 0);

      await db.collection(EVENTS).insertOne({
        voucherType: 'Receipt',
        party,
        amount,
        voucherNo,
        date: v.DATE || '',
        narration: v.NARRATION || '',
        receivedAt: new Date(),
        source: 'poll', // distinguish from TDL-pushed events
      });

      // Also update dealer's lastTallyPayment
      if (party) {
        await db.collection('dealers').updateOne(
          { dealer_name: { $regex: new RegExp(`^${party.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
          { $set: { lastTallyPayment: { amount, voucherNo, date: v.DATE || '', receivedAt: new Date() } } }
        );
      }

      inserted++;
    }

    if (inserted > 0) {
      console.log(`[ReceiptPoll] Caught ${inserted} missed receipt(s) from last 24h`);
    }
  } catch (err) {
    console.error('[ReceiptPoll] Failed:', err.message);
  }
}

function startReceiptPollJob() {
  // Run every 6 hours as a fallback net for missed TDL events
  cron.schedule('0 */6 * * *', runReceiptPoll);
  console.log('[ReceiptPoll] Scheduled: every 6 hours (TDL fallback)');
}

module.exports = { startReceiptPollJob, runReceiptPoll };
