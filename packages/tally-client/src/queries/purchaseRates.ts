import { esc, fmtTallyDate } from '../xml.js';

/**
 * Purchase vouchers with inventory lines — used to build the item → most-recent
 * purchase cost map. Deterministic cost fallback for items with zero closing
 * stock, where Tally has no ClosingRate/StandardCost to export (see
 * getCostPrice in parse/rates.ts). Mirrors salesRates.ts.
 */
export function buildPurchaseRatesXML(company: string, fromDate?: Date): string {
  const from = fromDate ? fmtTallyDate(fromDate) : '19900101';
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>PurchaseVouchersWithItems</ID>
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
          <COLLECTION NAME="PurchaseVouchersWithItems" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <FILTER>IsPurchaseVch</FILTER>
            <FETCH>Date, VoucherTypeName, VoucherNumber, InventoryEntries.List.StockItemName, InventoryEntries.List.Rate, InventoryEntries.List.Amount, InventoryEntries.List.BilledQty</FETCH>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="IsPurchaseVch">$$IsPurchase:$VoucherTypeName</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}
