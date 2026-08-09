import { asArray, parseAlterId, textAttr } from './common.js';
import type { LedgerJSON } from '../types.js';

export function parseLedger(l: any): LedgerJSON {
  return {
    masterId: textAttr(l, 'MASTERID'),
    alterId: parseAlterId(l.ALTERID ?? (l.$ && l.$.ALTERID)),
    guid: textAttr(l, 'GUID'),
    name: textAttr(l, 'NAME'),
    parent: textAttr(l, 'PARENT'),
    gstin: textAttr(l, 'PARTYGSTIN'),
  };
}

export function parseLedgerCollection(parsed: any): LedgerJSON[] {
  const collection = parsed?.ENVELOPE?.BODY?.DATA?.COLLECTION;
  if (!collection || !collection.LEDGER) return [];
  return asArray(collection.LEDGER).map(parseLedger);
}
