import { esc } from '../xml.js';

/**
 * Collection export of all Voucher Types configured in the active Tally company.
 * Fetches both standard built-in types (Sales, Purchase, Payment, ...) and custom
 * user-defined voucher types (GST SALES, Tax Invoice, Bank Receipt, ...).
 */
export function buildVoucherTypesXML(company: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>OpsVoucherTypeCollection</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="OpsVoucherTypeCollection" ISMODIFY="No">
            <TYPE>VoucherType</TYPE>
            <FETCH>Name, Parent</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}
