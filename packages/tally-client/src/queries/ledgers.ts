import { esc } from '../xml.js';

/**
 * Ledger collection export with change-tracking keys plus the party detail
 * fields (balances, address, contact, credit terms). Parties are just ledgers
 * under "Sundry Debtors"/"Sundry Creditors", so no parent filter is applied
 * here — every account ships and the consumer filters on `parent`, which stays
 * tolerant of Tally group-name variations.
 *
 * Tally ignores FETCH names it doesn't recognise rather than failing the
 * request, so older builds simply return the subset they know; the parser
 * defaults every missing field.
 */
export function buildLedgersXML(company: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>OpsLedgerCollection</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="OpsLedgerCollection" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <FETCH>MasterID, AlterID, GUID, Name, Parent, PartyGSTIN, GSTRegistrationType, OpeningBalance, ClosingBalance, LedgerContact, LedgerPhone, LedgerMobile, Email, LedgerStateName, CountryName, PinCode, CreditLimit, BillCreditPeriod, IsBillWiseOn, Address</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/**
 * Fallback: "List of Accounts" report export — the dialect project-o's
 * syncCustomers used. Some Tally builds answer this when TDL collections fail.
 */
export function buildLedgersFallbackXML(company: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>List of Accounts</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          <ACCOUNTTYPE>Ledgers</ACCOUNTTYPE>
          <SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;
}
