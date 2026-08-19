import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStringPromise } from 'xml2js';
import { parseStockCollection } from '../src/parse/stock.js';
import { parseVoucherCollection } from '../src/parse/vouchers.js';
import { parseSalesRates } from '../src/parse/salesRates.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const load = async (name: string) =>
  parseStringPromise(readFileSync(join(fixturesDir, name), 'utf8'), { explicitArray: false });

describe('parseStockCollection', () => {
  it('parses multiple items with change-tracking keys', async () => {
    const items = parseStockCollection(await load('stock-items.xml'));
    expect(items).toHaveLength(2);
    const [ply, lam] = items;
    expect(ply.name).toBe('Premium Plywood 18mm');
    expect(ply.masterId).toBe('101');
    expect(ply.alterId).toBe(2050);
    expect(ply.guid).toMatch(/000000000101$/);
    expect(ply.closingQty).toBe(42);
    expect(ply.closingRate).toBe(1450); // "/NOS" suffix stripped
    expect(ply.salePrice).toBe(1600); // STANDARDPRICE
    expect(ply.costPrice).toBe(1450); // CLOSINGRATE

    expect(lam.closingQty).toBe(7);
    expect(lam.salePrice).toBe(196); // from STANDARDPRICELIST.LIST, "/Set" stripped
    expect(lam.costPrice).toBe(196); // ClosingValue 1372 / qty 7
  });

  it('handles a single non-array item', async () => {
    const items = parseStockCollection(await load('stock-single.xml'));
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Solo Item');
    expect(items[0].costPrice).toBe(100); // 300 / 3
  });

  it('prefers last sale rate over standard price', async () => {
    const rates = new Map([['premium plywood 18mm', 1400]]);
    const items = parseStockCollection(await load('stock-items.xml'), rates);
    expect(items[0].salePrice).toBe(1400);
  });
});

describe('parseVoucherCollection', () => {
  it('parses vouchers with entries and cancellation flag', async () => {
    const vouchers = parseVoucherCollection(await load('vouchers.xml'));
    expect(vouchers).toHaveLength(2);
    const [sales, receipt] = vouchers;
    expect(sales.voucherType).toBe('Sales');
    expect(sales.voucherNumber).toBe('INV-042');
    expect(sales.party).toBe('Sharma Interiors');
    expect(sales.alterId).toBe(4100);
    expect(sales.isCancelled).toBe(false);
    expect(sales.amount).toBe(-33040);
    expect(sales.ledgerEntries).toHaveLength(1);
    expect(sales.ledgerEntries[0].isDeemedPositive).toBe(true);
    expect(sales.inventoryEntries).toHaveLength(1);
    expect(sales.inventoryEntries[0].rate).toBe(1400);
    expect(sales.narration).toContain('OPS-REF:ord_123');

    expect(receipt.isCancelled).toBe(true);
    expect(receipt.voucherType).toBe('Receipt');
  });
});

describe('parseSalesRates', () => {
  it('keeps the most recent rate per item', async () => {
    const rates = parseSalesRates(await load('sales-rates.xml'));
    expect(rates.get('laminate sheet teak')).toBe(196); // 20260805 beats 20260701
    expect(rates.get('premium plywood 18mm')).toBe(1400);
  });

  it('resolves rates from invoice-mode vouchers (ALLINVENTORYENTRIES.LIST, typed nodes)', async () => {
    // Real Tally GST Sales invoices export lines under ALLINVENTORYENTRIES.LIST
    // with STOCKITEMNAME/RATE as { _, $ } typed nodes, not the plain
    // INVENTORYENTRIES.LIST/string shape the other fixture covers.
    const rates = parseSalesRates(await load('sales-rates-invoice-mode.xml'));
    expect(rates.get('twin wheel plate 40mm')).toBe(196);
  });
});
