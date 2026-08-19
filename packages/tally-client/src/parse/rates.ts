/**
 * Price resolvers — ported verbatim from project-o
 * backend/tally/controllers/tallyController.ts (extractRate, extractRateFromList,
 * getSalePrice, getCostPrice). Behaviour intentionally identical.
 */

/**
 * Extract a numeric rate from a Tally XML field value.
 * Tally returns rates in formats like: "196.00", "196.00/Set", or as TYPE="Rate" attributes.
 */
export function extractRate(val: any): number {
  if (!val || (typeof val === 'string' && val.trim() === '')) return 0;
  const raw = val._ || val;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    // Strip unit suffix like "/Set", "/NOS" etc.
    const cleaned = raw.replace(/\/[A-Za-z]+$/, '').trim();
    return parseFloat(cleaned) || 0;
  }
  return 0;
}

/**
 * Extract a numeric rate from a Tally LIST field (STANDARDPRICELIST.LIST or STANDARDCOSTLIST.LIST).
 * These contain date-wise entries with a RATE sub-element.
 */
export function extractRateFromList(listVal: any): number {
  if (!listVal || (typeof listVal === 'string' && listVal.trim() === '')) return 0;
  const entries = Array.isArray(listVal) ? listVal : [listVal];
  for (const entry of entries) {
    if (!entry || typeof entry === 'string') continue;
    const rateVal = entry.RATE || (entry.$ && entry.$.RATE);
    const rate = extractRate(rateVal);
    if (rate > 0) return rate;
  }
  return 0;
}

/**
 * Get the Sale Price for a stock item from Tally.
 * Priority: last actual sale rate → STANDARDPRICE → STANDARDPRICELIST.LIST → 0
 */
export function getSalePrice(item: any, lastSaleRates: Map<string, number>): number {
  const name = item.NAME || (item.$ && item.$.NAME) || (typeof item === 'string' ? item : '');
  if (name) {
    const lsr = lastSaleRates.get(String(name).trim().toLowerCase());
    if (lsr && lsr > 0) return lsr;
  }

  const stdPrice = item.STANDARDPRICE || (item.$ && item.$.STANDARDPRICE);
  const sp = extractRate(stdPrice);
  if (sp > 0) return sp;

  const priceListRate = extractRateFromList(item['STANDARDPRICELIST.LIST']);
  if (priceListRate > 0) return priceListRate;

  return 0;
}

/**
 * Get the Cost Price for a stock item from Tally.
 * Priority: STANDARDCOST → CLOSINGRATE → STANDARDCOSTLIST.LIST →
 * ClosingValue/ClosingBalance → last purchase rate → 0
 *
 * The first four all depend on the item currently holding stock (Tally can't
 * compute a valuation rate for zero closing balance). A fully-sold-out item
 * — closingQty 0 — falls through all of them, so `lastPurchaseRates` (built
 * from actual Purchase vouchers, same pattern as getSalePrice's
 * lastSaleRates) is the deterministic backstop: any item ever purchased at
 * least once still resolves a real cost instead of 0.
 */
export function getCostPrice(item: any, lastPurchaseRates: Map<string, number> = new Map()): number {
  const stdCost = item.STANDARDCOST || (item.$ && item.$.STANDARDCOST);
  const sc = extractRate(stdCost);
  if (sc > 0) return sc;

  const closingRate = item.CLOSINGRATE || (item.$ && item.$.CLOSINGRATE);
  const cr = extractRate(closingRate);
  if (cr > 0) return cr;

  const costListRate = extractRateFromList(item['STANDARDCOSTLIST.LIST']);
  if (costListRate > 0) return costListRate;

  const closingVal = extractRate(item.CLOSINGVALUE || (item.$ && item.$.CLOSINGVALUE));
  const qtyVal =
    (item.CLOSINGBALANCE && (item.CLOSINGBALANCE._ || item.CLOSINGBALANCE)) ||
    (item.$ && item.$.CLOSINGBALANCE);
  const qty = parseFloat(qtyVal) || 0;
  if (closingVal > 0 && qty > 0) return parseFloat((closingVal / qty).toFixed(2));

  const name = item.NAME || (item.$ && item.$.NAME) || '';
  if (name) {
    const lpr = lastPurchaseRates.get(String(name).trim().toLowerCase());
    if (lpr && lpr > 0) return lpr;
  }

  return 0;
}
