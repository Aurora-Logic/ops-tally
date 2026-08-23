import { asArray, parseAlterId, parseAmount, parseBool, parseQty, text, textAttr } from './common.js';
import type { LedgerJSON } from '../types.js';

/** First non-empty of the given field names — absorbs Tally build-to-build renames. */
function firstOf(l: any, ...names: string[]): string {
  for (const name of names) {
    const v = textAttr(l, name);
    if (v) return v;
  }
  return '';
}

/**
 * Address lines. Tally exports them as <ADDRESS.LIST><ADDRESS>..</ADDRESS></ADDRESS.LIST>,
 * but a single-line address can arrive as a bare <ADDRESS> node instead.
 */
function parseAddress(l: any): string[] {
  const list = l?.['ADDRESS.LIST'];
  const raw = list ? (list.ADDRESS ?? list) : l?.ADDRESS;
  return asArray(raw)
    .map((line) => text(line).trim())
    .filter(Boolean);
}

export function parseLedger(l: any): LedgerJSON {
  return {
    masterId: textAttr(l, 'MASTERID'),
    alterId: parseAlterId(l.ALTERID ?? (l.$ && l.$.ALTERID)),
    guid: textAttr(l, 'GUID'),
    name: textAttr(l, 'NAME'),
    parent: textAttr(l, 'PARENT'),
    gstin: firstOf(l, 'PARTYGSTIN', 'GSTIN'),
    gstRegistrationType: textAttr(l, 'GSTREGISTRATIONTYPE'),
    openingBalance: parseAmount(l.OPENINGBALANCE ?? (l.$ && l.$.OPENINGBALANCE)),
    closingBalance: parseAmount(l.CLOSINGBALANCE ?? (l.$ && l.$.CLOSINGBALANCE)),
    address: parseAddress(l),
    state: firstOf(l, 'LEDGERSTATENAME', 'STATENAME'),
    country: firstOf(l, 'COUNTRYNAME', 'COUNTRYOFRESIDENCE'),
    pincode: firstOf(l, 'PINCODE', 'LEDGERPINCODE'),
    contactPerson: textAttr(l, 'LEDGERCONTACT'),
    phone: textAttr(l, 'LEDGERPHONE'),
    mobile: textAttr(l, 'LEDGERMOBILE'),
    email: textAttr(l, 'EMAIL'),
    creditLimit: parseAmount(l.CREDITLIMIT ?? (l.$ && l.$.CREDITLIMIT)),
    // "30 Days" / "30 Dys" / "30" — take the numeric part.
    creditPeriodDays: parseQty(l.BILLCREDITPERIOD ?? (l.$ && l.$.BILLCREDITPERIOD)),
    isBillWiseOn: parseBool(l, 'ISBILLWISEON'),
  };
}

export function parseLedgerCollection(parsed: any): LedgerJSON[] {
  const collection = parsed?.ENVELOPE?.BODY?.DATA?.COLLECTION;
  if (!collection || !collection.LEDGER) return [];
  return asArray(collection.LEDGER).map(parseLedger);
}
