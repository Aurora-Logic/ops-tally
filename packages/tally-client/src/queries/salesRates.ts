import { esc, fmtTallyDate } from '../xml.js';

/**
 * Sales vouchers with inventory lines — used to build the item → most-recent
 * sale rate map. Ported from project-o tallyController fetchSalesLastRates.
 */
export function buildSalesRatesXML(company: string, fromDate?: Date): string {
  const from = fromDate ? fmtTallyDate(fromDate) : '19900101';
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>SalesVouchersWithItems</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>
        <SVFROMDATE>${from}</SVFROMDATE>
        <SVTODATE>${fmtTallyDate(new Date())}</SVTODATE>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="SalesVouchersWithItems" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <FILTER>IsSalesVch</FILTER>
            <FETCH>Date, VoucherTypeName, VoucherNumber, InventoryEntries.List.StockItemName, InventoryEntries.List.Rate</FETCH>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="IsSalesVch">$$IsSales:$VoucherTypeName</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}
