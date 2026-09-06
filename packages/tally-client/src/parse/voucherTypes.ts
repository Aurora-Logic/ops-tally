import { asArray, textAttr, attr } from './common.js';
import type { VoucherTypeInfo } from '../types.js';

/**
 * Parses Tally's VoucherTypeCollection XML response into structured VoucherTypeInfo list.
 */
export function parseVoucherTypeCollection(parsed: any): VoucherTypeInfo[] {
  const collection = parsed?.ENVELOPE?.BODY?.DATA?.COLLECTION;
  if (!collection) return [];
  const rawList = collection.VOUCHERTYPE || collection.VOUCHER_TYPE || collection.VoucherType;
  if (!rawList) return [];

  const seen = new Set<string>();
  const results: VoucherTypeInfo[] = [];

  for (const v of asArray(rawList)) {
    const name = textAttr(v, 'NAME') || (typeof v === 'string' ? v.trim() : '') || attr(v, 'NAME');
    const parent = textAttr(v, 'PARENT') || attr(v, 'PARENT') || undefined;
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      results.push({ name, parent: parent || undefined });
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}
