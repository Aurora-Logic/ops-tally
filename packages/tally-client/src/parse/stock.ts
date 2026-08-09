import { asArray, parseAlterId, parseQty, textAttr } from './common.js';
import { extractRate, getCostPrice, getSalePrice } from './rates.js';
import type { StockItemJSON } from '../types.js';

export function parseStockItem(
  item: any,
  lastSaleRates: Map<string, number> = new Map()
): StockItemJSON {
  return {
    masterId: textAttr(item, 'MASTERID'),
    alterId: parseAlterId(item.ALTERID ?? (item.$ && item.$.ALTERID)),
    guid: textAttr(item, 'GUID'),
    name: textAttr(item, 'NAME'),
    parent: textAttr(item, 'PARENT'),
    baseUnits: textAttr(item, 'BASEUNITS'),
    closingQty: parseQty(item.CLOSINGBALANCE ?? (item.$ && item.$.CLOSINGBALANCE)),
    closingRate: extractRate(item.CLOSINGRATE || (item.$ && item.$.CLOSINGRATE)),
    closingValue: extractRate(item.CLOSINGVALUE || (item.$ && item.$.CLOSINGVALUE)),
    salePrice: getSalePrice(item, lastSaleRates),
    costPrice: getCostPrice(item),
  };
}

export function parseStockCollection(
  parsed: any,
  lastSaleRates: Map<string, number> = new Map()
): StockItemJSON[] {
  const collection = parsed?.ENVELOPE?.BODY?.DATA?.COLLECTION;
  if (!collection || !collection.STOCKITEM) return [];
  return asArray(collection.STOCKITEM).map((i) => parseStockItem(i, lastSaleRates));
}
