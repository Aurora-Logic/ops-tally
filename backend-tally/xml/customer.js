function buildCustomerXML({ name, phone, email, address, gstin }) {
  const gstFields = gstin ? `
      <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
      <PARTYGSTIN>${gstin}</PARTYGSTIN>` : '';

  const contactFields = [
    phone ? `<LEDPHONE>${phone}</LEDPHONE>` : '',
    email ? `<LEDEMAIL>${email}</LEDEMAIL>` : '',
  ].filter(Boolean).join('\n      ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY/>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <LEDGER NAME="${name}" ACTION="Create">
            <NAME>${name}</NAME>
            <PARENT>Sundry Debtors</PARENT>
            <LEDMAILINGNAME>${name}</LEDMAILINGNAME>
            <LEDADDRESS>${address || ''}</LEDADDRESS>
            ${contactFields}
            ${gstFields}
            <ISBILLWISEON>Yes</ISBILLWISEON>
            <OPENINGBALANCE>0</OPENINGBALANCE>
          </LEDGER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

module.exports = { buildCustomerXML };
