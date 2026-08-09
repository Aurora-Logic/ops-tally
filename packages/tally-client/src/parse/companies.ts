import { asArray, textAttr } from './common.js';
import type { CompanyInfo } from '../types.js';

export function parseCompanyCollection(parsed: any): CompanyInfo[] {
  const collection = parsed?.ENVELOPE?.BODY?.DATA?.COLLECTION;
  if (!collection || !collection.COMPANY) return [];
  return asArray(collection.COMPANY)
    .map((c: any) => ({
      name: textAttr(c, 'NAME') || (typeof c === 'string' ? c.trim() : ''),
      startingFrom: textAttr(c, 'STARTINGFROM') || undefined,
    }))
    .filter((c: CompanyInfo) => c.name.length > 0);
}
