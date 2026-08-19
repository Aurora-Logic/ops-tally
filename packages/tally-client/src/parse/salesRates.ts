import { asArray, text } from './common.js';
import { extractRate } from './rates.js';

/**
 * Build the item → most-recent sale rate map from a SalesVouchersWithItems
 * response. Ported from project-o tallyController fetchSalesLastRates.
 */
export function parseSalesRates(parsed: any): Map<string, number> {
  const lastSaleRates = new Map<string, number>();
  const collection = parsed?.ENVELOPE?.BODY?.DATA?.COLLECTION;
  if (!collection || !collection.VOUCHER) return lastSaleRates;

  const vouchers = asArray(collection.VOUCHER);
  // Latest first so the first rate seen per item is the most recent sale.
  vouchers.sort((a: any, b: any) => {
    const dateA = String(text(a.DATE) || '');
    const dateB = String(text(b.DATE) || '');
    return dateB.localeCompare(dateA);
  });

  for (const v of vouchers) {
    // Invoice-mode vouchers (the Tally default for GST Sales) export their lines
    // under ALLINVENTORYENTRIES.LIST, not INVENTORYENTRIES.LIST — same shape
    // drift parseVoucher() in parse/vouchers.ts already accounts for.
    const entries = asArray(v['ALLINVENTORYENTRIES.LIST'] ?? v['INVENTORYENTRIES.LIST']);
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      // STOCKITEMNAME arrives as a plain string only when the field has no TYPE
      // attribute; with one (the common case) it's { _, $ } like every other
      // typed node — text() unwraps both shapes the same way textAttr() does.
      const itemName = text(entry.STOCKITEMNAME ?? (entry.$ && entry.$.STOCKITEMNAME)).trim();
      const rateVal = entry.RATE || (entry.$ && entry.$.RATE);
      if (itemName) {
        const key = itemName.toLowerCase();
        if (!lastSaleRates.has(key)) {
          const rate = extractRate(rateVal);
          if (rate > 0) lastSaleRates.set(key, rate);
        }
      }
    }
  }
  return lastSaleRates;
}
