import { describe, expect, it } from 'vitest';
import { productNamesFrom } from '../src/main/engine/events.js';

describe('productNamesFrom', () => {
  it('returns the single item name for stock.updated', () => {
    expect(productNamesFrom('stock.updated', { name: 'Widget A' })).toEqual(['Widget A']);
  });

  it('returns all item names for stock.snapshot', () => {
    const payload = { items: [{ name: 'Widget A' }, { name: 'Widget B' }], chunk: 1, total_chunks: 1 };
    expect(productNamesFrom('stock.snapshot', payload)).toEqual(['Widget A', 'Widget B']);
  });

  it('skips malformed entries instead of throwing', () => {
    const payload = { items: [{ name: 'Widget A' }, { notName: 'oops' }, null] };
    expect(productNamesFrom('stock.snapshot', payload)).toEqual(['Widget A']);
  });

  it('returns undefined for event types with no product data', () => {
    expect(productNamesFrom('ping', { message: 'hi' })).toBeUndefined();
    expect(productNamesFrom('voucher.created', { party: 'Acme' })).toBeUndefined();
  });
});
