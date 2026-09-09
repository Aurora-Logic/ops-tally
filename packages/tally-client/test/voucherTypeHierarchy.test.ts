import { describe, expect, it } from 'vitest';
import { resolveVoucherTypeRoots } from '../src/voucherTypeHierarchy.js';

describe('resolveVoucherTypeRoots', () => {
  it('resolves a type with no parent to itself', () => {
    const roots = resolveVoucherTypeRoots([{ name: 'Sales' }]);
    expect(roots.get('Sales')).toBe('Sales');
  });

  it('resolves a one-hop custom type to its parent', () => {
    const roots = resolveVoucherTypeRoots([{ name: 'Sales' }, { name: 'GST SALES', parent: 'Sales' }]);
    expect(roots.get('GST SALES')).toBe('Sales');
  });

  it('walks a multi-level nested custom type to the root', () => {
    const roots = resolveVoucherTypeRoots([
      { name: 'Sales' },
      { name: 'GST Sales', parent: 'Sales' },
      { name: 'Retail GST Sales', parent: 'GST Sales' },
    ]);
    expect(roots.get('Retail GST Sales')).toBe('Sales');
    expect(roots.get('GST Sales')).toBe('Sales');
    expect(roots.get('Sales')).toBe('Sales');
  });

  it('trusts a parent name even when that parent is not itself in the collection', () => {
    const roots = resolveVoucherTypeRoots([{ name: 'GST SALES', parent: 'Sales' }]);
    expect(roots.get('GST SALES')).toBe('Sales');
  });

  it('never infinite-loops on a parent cycle', () => {
    const roots = resolveVoucherTypeRoots([
      { name: 'A', parent: 'B' },
      { name: 'B', parent: 'A' },
    ]);
    expect(roots.get('A')).toBeDefined();
    expect(roots.get('B')).toBeDefined();
  });

  it('resolves every distinct built-in primary type to itself', () => {
    const primaries = ['Sales', 'Purchase', 'Receipt', 'Payment', 'Journal', 'Contra', 'Credit Note', 'Debit Note'];
    const roots = resolveVoucherTypeRoots(primaries.map((name) => ({ name })));
    for (const name of primaries) expect(roots.get(name)).toBe(name);
  });
});
