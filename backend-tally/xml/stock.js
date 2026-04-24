const { XMLParser } = require('fast-xml-parser');
const { sendToTally } = require('../bridge');

function buildStockQueryXML() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Stock Items</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          <SVCURRENTCOMPANY/>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;
}

async function fetchStockLevels() {
  const xml = buildStockQueryXML();
  const rawXml = await sendToTally(xml);

  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
  const parsed = parser.parse(rawXml);

  const envelope = parsed?.ENVELOPE?.BODY?.DATA?.COLLECTION;
  const rawItems = envelope?.STOCKITEM || [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  return items.map((item) => ({
    name: item.NAME,
    closingQty: parseFloat(item.CLOSINGBALANCE) || 0,
    unit: item.BASEUNITS || 'NOS',
    rate: parseFloat(item.RATE) || 0,
  }));
}

async function canFulfill(orderItems) {
  const stockLevels = await fetchStockLevels();
  const stockMap = new Map(stockLevels.map((s) => [s.name.toLowerCase(), s]));

  const shortfalls = [];

  for (const { name, qty } of orderItems) {
    const stock = stockMap.get(name.toLowerCase());
    const available = stock ? stock.closingQty : 0;
    if (available < qty) {
      shortfalls.push({ item: name, required: qty, available });
    }
  }

  return { ok: shortfalls.length === 0, shortfalls };
}

module.exports = { buildStockQueryXML, fetchStockLevels, canFulfill };
