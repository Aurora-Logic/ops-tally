const express = require('express');
const { XMLParser } = require('fast-xml-parser');
const { STOCK_ITEMS, CUSTOMERS } = require('./mockData');

const app = express();
app.use(express.text({ type: 'text/xml' }));

const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });

function stockXML() {
  const items = STOCK_ITEMS.map((s) => `
    <STOCKITEM>
      <NAME>${s.NAME}</NAME>
      <CLOSINGBALANCE>${s.CLOSINGBALANCE}</CLOSINGBALANCE>
      <BASEUNITS>${s.BASEUNITS}</BASEUNITS>
      <RATE>${s.RATE}</RATE>
    </STOCKITEM>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <BODY>
    <DATA>
      <COLLECTION>
        ${items}
      </COLLECTION>
    </DATA>
  </BODY>
</ENVELOPE>`;
}

function customersXML() {
  const ledgers = CUSTOMERS.map((c) => `
    <LEDGER>
      <NAME>${c.NAME}</NAME>
      ${c.LEDPHONE ? `<LEDPHONE>${c.LEDPHONE}</LEDPHONE>` : ''}
      ${c.LEDEMAIL ? `<LEDEMAIL>${c.LEDEMAIL}</LEDEMAIL>` : ''}
      ${c.PARTYGSTIN ? `<PARTYGSTIN>${c.PARTYGSTIN}</PARTYGSTIN>` : ''}
      <OPENINGBALANCE>${c.OPENINGBALANCE}</OPENINGBALANCE>
    </LEDGER>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <BODY>
    <DATA>
      <COLLECTION>
        ${ledgers}
      </COLLECTION>
    </DATA>
  </BODY>
</ENVELOPE>`;
}

const successXML = `<?xml version="1.0" encoding="UTF-8"?>
<RESPONSE>
  <CREATED>1</CREATED>
  <ALTERED>0</ALTERED>
  <LASTVCHID>1001</LASTVCHID>
</RESPONSE>`;

app.post('/', (req, res) => {
  const body = req.body || '';
  let parsed;
  try {
    parsed = parser.parse(body);
  } catch {
    parsed = {};
  }

  const reportName = parsed?.ENVELOPE?.BODY?.EXPORTDATA?.REQUESTDESC?.REPORTNAME
    || parsed?.ENVELOPE?.BODY?.IMPORTDATA?.REQUESTDESC?.REPORTNAME
    || '';

  const tallyRequest = parsed?.ENVELOPE?.HEADER?.TALLYREQUEST || '';
  const voucherType = parsed?.ENVELOPE?.BODY?.IMPORTDATA?.REQUESTDATA
    ?.TALLYMESSAGE?.VOUCHER?.['@_VCHTYPE'] || 'Unknown';

  if (tallyRequest === 'Export Data') {
    if (/Stock Items/i.test(reportName)) {
      console.log('[Mock] Received: Stock Items query');
      res.type('text/xml').send(stockXML());
    } else if (/Ledger/i.test(reportName)) {
      console.log('[Mock] Received: Ledger (customers) query');
      res.type('text/xml').send(customersXML());
    } else {
      console.log(`[Mock] Received: unknown export — reportName="${reportName}"`);
      res.type('text/xml').send(successXML);
    }
  } else {
    console.log(`[Mock] Received: Import Data — voucherType="${voucherType}"`);
    res.type('text/xml').send(successXML);
  }
});

const PORT = 9000;
app.listen(PORT, () => console.log(`[Mock Tally] Listening on http://localhost:${PORT}`));
