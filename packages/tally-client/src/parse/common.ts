/**
 * Accessors that absorb xml2js shape drift: Tally returns the same field
 * sometimes as an element, sometimes as an attribute, and text nodes with
 * attributes arrive as { _: "value", $: {...} }.
 */

/** Extract the text content of an xml2js node in any of its shapes. */
export function text(node: any): string {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (typeof node._ === 'string' || typeof node._ === 'number') return String(node._);
  return '';
}

/** Read a field that may live as an element or as an attribute ($.NAME). */
export function attr(item: any, name: string): any {
  if (!item || typeof item !== 'object') return undefined;
  return item[name] ?? (item.$ && item.$[name]);
}

/** Field as trimmed string, whichever shape it arrived in. */
export function textAttr(item: any, name: string): string {
  return text(attr(item, name)).trim();
}

/** Coerce a possibly-single, possibly-missing xml2js child into an array. */
export function asArray<T = any>(val: T | T[] | undefined | null): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

/** Parse a Tally quantity like " 5 NOS" or "5.00 Set" into its numeric part. */
export function parseQty(val: any): number {
  const s = text(val).trim();
  if (!s) return 0;
  const m = /-?[\d.]+/.exec(s);
  return m ? parseFloat(m[0]) || 0 : 0;
}

/** Parse Tally's AlterID field (integer counter). */
export function parseAlterId(val: any): number {
  const n = parseInt(text(val).trim(), 10);
  return Number.isNaN(n) ? 0 : n;
}

/** Parse a Tally money field like "-12,500.00" into a number. */
export function parseAmount(val: any): number {
  const s = text(val).trim();
  if (!s) return 0;
  return parseFloat(s.replace(/,/g, '')) || 0;
}

/** "Yes"/"No" flag, whichever shape it arrived in. */
export function parseBool(item: any, name: string): boolean {
  return textAttr(item, name).toLowerCase() === 'yes';
}
