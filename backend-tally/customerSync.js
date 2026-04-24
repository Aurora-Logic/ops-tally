const { XMLParser } = require('fast-xml-parser');
const { sendToTally } = require('./bridge');

// In OPS, Tally "customers" are Dealers. Require the model at runtime to avoid
// circular deps and to allow this module to be used before DB connects.
function getDealerModel() {
  return require('../models/Dealer').default;
}

function buildCustomerQueryXML() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Ledger</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          <SVCURRENTCOMPANY/>
          <LEDGROUPFILTER>Sundry Debtors</LEDGROUPFILTER>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;
}

async function syncCustomersToOPS() {
  const Dealer = getDealerModel();
  const rawXml = await sendToTally(buildCustomerQueryXML());

  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
  const parsed = parser.parse(rawXml);

  const envelope = parsed?.ENVELOPE?.BODY?.DATA?.COLLECTION;
  const rawLedgers = envelope?.LEDGER || [];
  const ledgers = Array.isArray(rawLedgers) ? rawLedgers : [rawLedgers];

  let upserted = 0;
  let errors = 0;

  for (const ledger of ledgers) {
    const name = ledger.NAME;
    if (!name) continue;

    try {
      const phones = ledger.LEDPHONE
        ? [String(ledger.LEDPHONE)]
        : ['0000000000'];

      await Dealer.findOneAndUpdate(
        { dealer_name: name },
        {
          $setOnInsert: {
            dealer_name: name,
            dealer_phone: phones,
            dealer_gstNo: ledger.PARTYGSTIN || '',
            dealer_baseDiscount: 0,
            dealer_cashDiscount: 0,
            dealer_status: 'active',
          },
        },
        { upsert: true, new: true }
      );
      upserted++;
    } catch (err) {
      console.error(`[CustomerSync] Failed to upsert dealer "${name}": ${err.message}`);
      errors++;
    }
  }

  return { ok: errors === 0, total: ledgers.length, upserted, errors };
}

// alias so tallyAdmin route can call runSync directly
module.exports = { syncCustomersToOPS, runSync: syncCustomersToOPS };
