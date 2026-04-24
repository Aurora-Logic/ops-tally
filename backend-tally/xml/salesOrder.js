function buildSalesOrderXML({ date, customerName, items }) {
  const fmt = (d) => new Date(d).toISOString().slice(0, 10).replace(/-/g, '');

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
          <SVCURRENTCOMPANY/>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Sales Order" ACTION="Create">
            <DATE>${fmt(date)}</DATE>
            <VOUCHERTYPENAME>Sales Order</VOUCHERTYPENAME>
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
