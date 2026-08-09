import { asArray, parseAlterId, textAttr } from './common.js';
import { extractRate } from './rates.js';
import type { VoucherJSON, VoucherInventoryEntry, VoucherLedgerEntry } from '../types.js';

function parseAmount(val: string): number {
  if (!val) return 0;
  return parseFloat(val.replace(/,/g, '')) || 0;
}

export function parseVoucher(v: any): VoucherJSON {
  const ledgerRaw = v['ALLLEDGERENTRIES.LIST'] ?? v['LEDGERENTRIES.LIST'];
  const ledgerEntries: VoucherLedgerEntry[] = asArray(ledgerRaw)
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({
      ledgerName: textAttr(e, 'LEDGERNAME'),
      amount: parseAmount(textAttr(e, 'AMOUNT')),
      isDeemedPositive: textAttr(e, 'ISDEEMEDPOSITIVE').toLowerCase() === 'yes',
    }));

  const invRaw = v['ALLINVENTORYENTRIES.LIST'] ?? v['INVENTORYENTRIES.LIST'];
  const inventoryEntries: VoucherInventoryEntry[] = asArray(invRaw)
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({
      stockItemName: textAttr(e, 'STOCKITEMNAME'),
      actualQty: textAttr(e, 'ACTUALQTY'),
      billedQty: textAttr(e, 'BILLEDQTY'),
      rate: extractRate(e.RATE || (e.$ && e.$.RATE)),
      amount: parseAmount(textAttr(e, 'AMOUNT')),
    }));

  return {
    masterId: textAttr(v, 'MASTERID'),
    alterId: parseAlterId(v.ALTERID ?? (v.$ && v.$.ALTERID)),
    guid: textAttr(v, 'GUID'),
    date: textAttr(v, 'DATE'),
    voucherType: textAttr(v, 'VOUCHERTYPENAME') || (v.$ && v.$.VCHTYPE) || '',
    voucherNumber: textAttr(v, 'VOUCHERNUMBER') || textAttr(v, 'VCHNO'),
    party: textAttr(v, 'PARTYLEDGERNAME') || textAttr(v, 'PARTYNAME'),
    narration: textAttr(v, 'NARRATION'),
    isCancelled: textAttr(v, 'ISCANCELLED').toLowerCase() === 'yes',
    amount: parseAmount(textAttr(v, 'AMOUNT')),
    ledgerEntries,
    inventoryEntries,
  };
}

export function parseVoucherCollection(parsed: any): VoucherJSON[] {
  const collection = parsed?.ENVELOPE?.BODY?.DATA?.COLLECTION;
  if (!collection || !collection.VOUCHER) return [];
  return asArray(collection.VOUCHER).map(parseVoucher);
}
