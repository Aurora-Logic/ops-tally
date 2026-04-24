const { tallyCompany } = require('../config');

// Fix 3: refId written into NARRATION so the TDL webhook can match it back to an OPS order.
// Fix 10: respects TALLY_COMPANY env var to prevent cross-company sync accidents.
function buildSalesOrderXML({ date, customerName, items, refId }) {
  const fmt = (d) => new Date(d).toISOString().slice(0, 10).replace(/-/g, '');
  const company = tallyCompany;

  const inventoryLines = items.map(({ name, qty, rate }) => `
    <INVENTORYENTRIES.LIST>
      <STOCKITEMNAME>${name}</STOCKITEMNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <ACTUALQTY>${qty} NOS</ACTUALQTY>
      <BILLEDQTY>${qty} NOS</BILLEDQTY>
      <RATE>${rate}/NOS</RATE>
      <AMOUNT>-${(qty * rate).toFixed(2)}</AMOUNT>
    </INVENTORYENTRIES.LIST>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Sales Order" ACTION="Create">
            <DATE>${fmt(date)}</DATE>
            <VOUCHERTYPENAME>Sales Order</VOUCHERTYPENAME>
            <NARRATION>OPS-REF:${refId || ''}</NARRATION>
            <PARTYLEDGERNAME>${customerName}</PARTYLEDGERNAME>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${customerName}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>-${items.reduce((s, i) => s + i.qty * i.rate, 0).toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            ${inventoryLines}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

module.exports = { buildSalesOrderXML };
