const { computeTax } = require('./gst');
const { tallyCompany } = require('../config');

// Fix 5: Creates a Credit Note (Sales Return) in Tally when an OPS order is cancelled.
// A credit note is the standard accounting reversal — it offsets the original sales entry
// without needing the original voucher number (which we don't store).
function buildCancellationXML({ date, customerName, items, isInterState = false, refId }) {
  const fmt = (d) => new Date(d).toISOString().slice(0, 10).replace(/-/g, '');
  const company = tallyCompany;

  let subtotal = 0;
  const taxAccumulator = {};

  const inventoryLines = items.map(({ name, qty, rate, gstRate = 18 }) => {
    const lineAmt = qty * rate;
    subtotal += lineAmt;

    const taxes = computeTax(lineAmt, gstRate, isInterState);
    taxes.forEach(({ ledger, amount }) => {
      taxAccumulator[ledger] = (taxAccumulator[ledger] || 0) + amount;
    });

    const accountingAllocations = taxes.map(({ ledger, amount }) => `
        <ACCOUNTINGALLOCATIONS.LIST>
          <LEDGERNAME>${ledger}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          <AMOUNT>${amount.toFixed(2)}</AMOUNT>
        </ACCOUNTINGALLOCATIONS.LIST>`).join('');

    return `
    <INVENTORYENTRIES.LIST>
      <STOCKITEMNAME>${name}</STOCKITEMNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <BILLEDQTY>${qty} NOS</BILLEDQTY>
      <ACTUALQTY>${qty} NOS</ACTUALQTY>
      <RATE>${rate}/NOS</RATE>
      <AMOUNT>${lineAmt.toFixed(2)}</AMOUNT>
      ${accountingAllocations}
    </INVENTORYENTRIES.LIST>`;
  });

  const totalTax = Object.values(taxAccumulator).reduce((s, a) => s + a, 0);
  const grandTotal = subtotal + totalTax;

  const taxLedgerLines = Object.entries(taxAccumulator).map(([ledger, amount]) => `
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${ledger}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>${amount.toFixed(2)}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>`).join('');

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
          <VOUCHER VCHTYPE="Credit Note" ACTION="Create">
            <DATE>${fmt(date)}</DATE>
            <VOUCHERTYPENAME>Credit Note</VOUCHERTYPENAME>
            <NARRATION>ORDER CANCELLED — OPS-REF:${refId || ''}</NARRATION>
            <PARTYLEDGERNAME>${customerName}</PARTYLEDGERNAME>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${customerName}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${grandTotal.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            ${taxLedgerLines}
            ${inventoryLines.join('')}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

module.exports = { buildCancellationXML };
