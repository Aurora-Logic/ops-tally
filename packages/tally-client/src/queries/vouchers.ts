import { esc, fmtTallyDate } from '../xml.js';
import type { VoucherQueryOptions } from '../types.js';

/**
 * Collection export of vouchers in a date range, optionally filtered to
 * AlterID > watermark (Tally's native change counter) and/or a voucher type.
 * Envelope shape from project-o tallyController fetchSalesLastRates +
 * backend-tally receiptPollJob.
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
  if (opts.voucherType) {
    filters.push('OpsVchTypeFilter');
    formulae.push(
      `<SYSTEM TYPE="Formulae" NAME="OpsVchTypeFilter">$VoucherTypeName = "${esc(opts.voucherType)}"</SYSTEM>`
    );
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
            <FETCH>MasterID, AlterID, GUID, Date, VoucherTypeName, VoucherNumber, PartyLedgerName, Narration, IsCancelled, Amount, LedgerEntries.List, AllInventoryEntries.List</FETCH>
          </COLLECTION>
          ${formulae.join('\n          ')}
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}
