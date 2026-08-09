import { esc } from '../xml.js';

/**
 * StockItem collection export — ported from project-o tallyController
 * fetchStockItems, extended with MasterID/AlterID/GUID for change tracking.
 */
export function buildStockItemsXML(company: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>StockItemCollection</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="StockItemCollection" ISINTERNAL="No">
            <TYPE>StockItem</TYPE>
            <FETCH>MasterID, AlterID, GUID, Name, Parent, BaseUnits, ClosingBalance, ClosingRate, ClosingValue, StandardPrice, StandardCost, StandardPriceList.List, StandardCostList.List</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}
