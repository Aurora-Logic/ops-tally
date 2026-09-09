import type { VoucherTypeInfo } from './types.js';

/**
 * Every company renames and nests its voucher types differently — "Sales" can
 * ship as "GST SALES" with parent "Sales", or three levels deep as "Retail GST
 * Sales" -> "GST Sales" -> "Sales". What is constant across every Tally
 * install is the small set of primary types (Sales, Purchase, Receipt,
 * Payment, Journal, ...) that every custom type ultimately chains up to via
 * its PARENT. Resolving each type name to that root, once, is what lets a
 * consumer classify a voucher by what it economically IS rather than by
 * matching a string one company happened to type into a name field.
 *
 * Returns a map from every type's own name to its resolved root name. A type
 * with no parent (or whose parent isn't itself in the collection) is its own
 * root.
 */
export function resolveVoucherTypeRoots(types: readonly VoucherTypeInfo[]): Map<string, string> {
  const parentByName = new Map<string, string | undefined>();
  for (const t of types) parentByName.set(t.name, t.parent || undefined);

  const roots = new Map<string, string>();

  function resolve(name: string, seen: Set<string>): string {
    const cached = roots.get(name);
    if (cached) return cached;
    // A parent cycle should never happen in real Tally data, but a name
    // revisited mid-walk must not recurse forever — treat it as its own root.
    if (seen.has(name)) return name;
    seen.add(name);

    const parent = parentByName.get(name);
    let root: string;
    if (!parent) {
      root = name;
    } else if (parentByName.has(parent)) {
      root = resolve(parent, seen);
    } else {
      // Parent named but not itself in the collection — trust the name we have.
      root = parent;
    }
    roots.set(name, root);
    return root;
  }

  for (const t of types) resolve(t.name, new Set());
  return roots;
}
