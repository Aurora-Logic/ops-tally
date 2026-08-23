import { esc, fmtTallyDate } from '../xml.js';
import type { VoucherQueryOptions } from '../types.js';

/**
 * Collection export of vouchers in a date range, optionally filtered to
 * AlterID > watermark (Tally's native change counter) and/or a voucher type.
 * Envelope shape from project-o tallyController fetchSalesLastRates +
 * backend-tally receiptPollJob.
 *
 * On the date range: Tally scopes a voucher collection to the FINANCIAL YEAR
 * containing the range, not to the range. A one-day window and a ten-year
 * window both return one year, which is why the poller walks years rather than
 * narrowing dates. See Poller.pollVouchers.
 *
 * On the FETCH list: the order/terms/dispatch/consignee fields roughly double
 * the response (measured 45.5 KB -> 84.9 KB per voucher on a real company).
 * That is affordable only because the AlterID filter is applied by Tally, so a
 * steady-state poll returns almost nothing. A baseline pass over a large
 * company is genuinely heavy — narrow it with the voucher type allowlist.
 *
 * `AllLedgerEntries.List` rather than `LedgerEntries.List`: the latter comes
 * back empty on Receipt vouchers. Bank settlement detail (payment type) rides
 * inside AllLedgerEntries as a nested BankAllocations list and needs no FETCH
 * name of its own.
 */
export function buildVouchersXML(company: string, opts: VoucherQueryOptions): string {
  const filters: string[] = [];
  const formulae: string[] = [];

  if (opts.alterIdAbove !== undefined) {
    filters.push('OpsAlterIdFilter');
    formulae.push(
      `<SYSTEM TYPE="Formulae" NAME="OpsAlterIdFilter">$AlterID &gt; ${Math.floor(opts.alterIdAbove)}</SYSTEM>`
    );
  }
  if (opts.voucherTypes && opts.voucherTypes.length) {
    filters.push('OpsVchTypeFilter');
    const conditions = opts.voucherTypes.map((t) => `$VoucherTypeName = "${esc(t)}"`).join(' OR ');
    formulae.push(`<SYSTEM TYPE="Formulae" NAME="OpsVchTypeFilter">${conditions}</SYSTEM>`);
  }

  const filterLine = filters.length ? `<FILTER>${filters.join(', ')}</FILTER>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>OpsVoucherCollection</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>
        <SVFROMDATE>${fmtTallyDate(opts.fromDate)}</SVFROMDATE>
        <SVTODATE>${fmtTallyDate(opts.toDate)}</SVTODATE>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="OpsVoucherCollection" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            ${filterLine}
            <FETCH>MasterID, AlterID, GUID, Date, VoucherTypeName, VoucherNumber, PartyLedgerName, Narration, IsCancelled, Amount, Reference, ReferenceDate, BasicOrderRef, BasicPurchaseOrderNo, BasicOrderDate, BasicDueDateOfPymt, BasicOrderTerms, BasicShippedBy, BasicShipDocumentNo, BasicShipVesselNo, BasicFinalDestination, BasicBuyerName, BasicBuyerAddress, PartyMailingName, PartyGSTIN, StateName, PlaceOfSupply, CountryOfResidence, ConsigneeMailingName, ConsigneeStateName, ConsigneePinCode, ConsigneeGSTIN, AllLedgerEntries.List, AllInventoryEntries.List</FETCH>
          </COLLECTION>
          ${formulae.join('\n          ')}
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}
