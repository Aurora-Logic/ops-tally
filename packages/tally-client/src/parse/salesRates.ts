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
    const entries = asArray(v['INVENTORYENTRIES.LIST']);
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const itemName = entry.STOCKITEMNAME || (entry.$ && entry.$.STOCKITEMNAME);
      const rateVal = entry.RATE || (entry.$ && entry.$.RATE);
      if (itemName && typeof itemName === 'string') {
        const key = itemName.trim().toLowerCase();
        if (!lastSaleRates.has(key)) {
          const rate = extractRate(rateVal);
          if (rate > 0) lastSaleRates.set(key, rate);
        }
      }
    }
  }
  return lastSaleRates;
}
