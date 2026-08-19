import { asArray, parseQty, text } from './common.js';

function parseAmount(val: any): number {
  const raw = text(val).trim();
  if (!raw) return 0;
  return Math.abs(parseFloat(raw.replace(/,/g, '')) || 0);
}

/**
 * Build the item → most-recent net purchase cost map (Amount/BilledQty, so
 * line discounts are baked in the same way Tally's own "Cost price" column
 * is) from a PurchaseVouchersWithItems response. Used as the deterministic
 * cost fallback for fully-sold-out items — see getCostPrice in rates.ts.
 */
export function parsePurchaseRates(parsed: any): Map<string, number> {
  const lastPurchaseRates = new Map<string, number>();
  const collection = parsed?.ENVELOPE?.BODY?.DATA?.COLLECTION;
  if (!collection || !collection.VOUCHER) return lastPurchaseRates;

  const vouchers = asArray(collection.VOUCHER);
  // Latest first so the first rate seen per item is the most recent purchase.
  vouchers.sort((a: any, b: any) => {
    const dateA = String(text(a.DATE) || '');
    const dateB = String(text(b.DATE) || '');
    return dateB.localeCompare(dateA);
  });

  for (const v of vouchers) {
    // Invoice-mode vouchers export lines under ALLINVENTORYENTRIES.LIST, not
    // INVENTORYENTRIES.LIST — same shape drift as parseVoucher/parseSalesRates.
    const entries = asArray(v['ALLINVENTORYENTRIES.LIST'] ?? v['INVENTORYENTRIES.LIST']);
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const itemName = text(entry.STOCKITEMNAME ?? (entry.$ && entry.$.STOCKITEMNAME)).trim();
      if (!itemName) continue;

      const key = itemName.toLowerCase();
      if (lastPurchaseRates.has(key)) continue;

      const amount = parseAmount(entry.AMOUNT ?? (entry.$ && entry.$.AMOUNT));
      const qty = parseQty(entry.BILLEDQTY ?? entry.ACTUALQTY ?? (entry.$ && (entry.$.BILLEDQTY ?? entry.$.ACTUALQTY)));
      if (amount > 0 && qty > 0) {
        lastPurchaseRates.set(key, parseFloat((amount / qty).toFixed(2)));
      }
    }
  }
  return lastPurchaseRates;
}
