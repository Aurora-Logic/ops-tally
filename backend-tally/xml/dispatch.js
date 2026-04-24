const { computeTax } = require('./gst');

function buildDispatchXML({ date, customerName, items, isInterState, paymentMode, orderRef }) {
  const fmt = (d) => new Date(d).toISOString().slice(0, 10).replace(/-/g, '');

  let subtotal = 0;
  const taxAccumulator = {};

  const inventoryLines = items.map(({ name, qty, rate, gstRate }) => {
    const lineAmt = qty * rate;
    subtotal += lineAmt;

    const taxes = computeTax(lineAmt, gstRate, isInterState);
    taxes.forEach(({ ledger, amount }) => {
      taxAccumulator[ledger] = (taxAccumulator[ledger] || 0) + amount;
    });

    const accountingAllocations = taxes.map(({ ledger, amount }) => `
        <ACCOUNTINGALLOCATIONS.LIST>
          <LEDGERNAME>${ledger}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>-${amount.toFixed(2)}</AMOUNT>
        </ACCOUNTINGALLOCATIONS.LIST>`).join('');

    return `
    <INVENTORYENTRIES.LIST>
      <STOCKITEMNAME>${name}</STOCKITEMNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <BILLEDQTY>${qty} NOS</BILLEDQTY>
      <ACTUALQTY>${qty} NOS</ACTUALQTY>
      <RATE>${rate}/NOS</RATE>
      <AMOUNT>-${lineAmt.toFixed(2)}</AMOUNT>
      ${accountingAllocations}
    </INVENTORYENTRIES.LIST>`;
  });

  const totalTax = Object.values(taxAccumulator).reduce((s, a) => s + a, 0);
  const grandTotal = subtotal + totalTax;

  const taxLedgerLines = Object.entries(taxAccumulator).map(([ledger, amount]) => `
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${ledger}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>-${amount.toFixed(2)}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>`).join('');

  const paymentLedger = paymentMode === 'Cash' ? 'Cash' : 'Bank Account';

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
          <SVCURRENTCOMPANY/>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Sales" ACTION="Create">
            <DATE>${fmt(date)}</DATE>
            <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
            <NARRATION>Against Order Ref: ${orderRef}</NARRATION>
            <PARTYLEDGERNAME>${customerName}</PARTYLEDGERNAME>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${customerName}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            ${taxLedgerLines}
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${paymentLedger}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${grandTotal.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            ${inventoryLines.join('')}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

module.exports = { buildDispatchXML };
