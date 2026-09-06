import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStringPromise } from 'xml2js';
import { parseStockCollection } from '../src/parse/stock.js';
import { parseVoucherCollection } from '../src/parse/vouchers.js';
import { parseSalesRates } from '../src/parse/salesRates.js';
import { parseLedgerCollection } from '../src/parse/ledgers.js';
import { parseVoucherTypeCollection } from '../src/parse/voucherTypes.js';

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

describe('parseLedgerCollection', () => {
  it('parses party detail — balances, address, contact, credit terms', async () => {
    const ledgers = parseLedgerCollection(await load('ledgers.xml'));
    expect(ledgers).toHaveLength(3);

    const [acme, bharat, bank] = ledgers;

    expect(acme.name).toBe('Acme Traders');
    expect(acme.parent).toBe('Sundry Debtors');
    expect(acme.masterId).toBe('412');
    expect(acme.alterId).toBe(3180);
    expect(acme.gstin).toBe('27AABCU9603R1ZM');
    expect(acme.gstRegistrationType).toBe('Regular');
    // Tally sign convention: debit positive, credit negative. Thousands
    // separators are Indian-grouped and must survive.
    expect(acme.openingBalance).toBe(-25000);
    expect(acme.closingBalance).toBe(184250.5);
    expect(acme.address).toEqual(['Unit 4, Sunmill Compound', 'Lower Parel West', 'Mumbai']);
    expect(acme.state).toBe('Maharashtra');
    expect(acme.country).toBe('India');
    expect(acme.pincode).toBe('400018');
    expect(acme.contactPerson).toBe('Ravi Menon');
    expect(acme.phone).toBe('022-24001188');
    expect(acme.mobile).toBe('9820011223');
    expect(acme.email).toBe('accounts@acmetraders.in');
    expect(acme.creditLimit).toBe(500000);
    expect(acme.creditPeriodDays).toBe(45); // "45 Days" -> numeric part
    expect(acme.isBillWiseOn).toBe(true);

    // Single-line address still lands as a one-element array.
    expect(bharat.parent).toBe('Sundry Creditors');
    expect(bharat.closingBalance).toBe(-62400);
    expect(bharat.address).toEqual(['Plot 12, Peenya Industrial Area']);
    expect(bharat.isBillWiseOn).toBe(false);

    // Non-party ledgers come through the same collection — consumers filter on
    // `parent`. Absent fields default rather than blowing up.
    expect(bank.parent).toBe('Bank Accounts');
    expect(bank.closingBalance).toBe(905432.1);
    expect(bank.gstin).toBe('');
    expect(bank.address).toEqual([]);
    expect(bank.creditPeriodDays).toBe(0);
    expect(bank.isBillWiseOn).toBe(false);
  });

  it('returns an empty list when the collection is absent', () => {
    expect(parseLedgerCollection({})).toEqual([]);
    expect(parseLedgerCollection({ ENVELOPE: { BODY: { DATA: { COLLECTION: {} } } } })).toEqual([]);
  });
});

describe('parseVoucher order, terms, dispatch and settlement detail', () => {
  it('reads the dispatch fields one company fills and the order/terms fields the other does', async () => {
    const [gstSales, solar] = parseVoucherCollection(await load('vouchers-detail.xml'));

    // Company A records who carried the goods, and nothing about order terms.
    expect(gstSales.dispatchedThrough).toBe('Harish / Rutik');
    expect(gstSales.dispatchDocNo).toBe('ORD-INN/24_25/00012');
    expect(gstSales.buyerName).toBe('Fatema Trading Co (Dwarka)');
    expect(gstSales.consigneeName).toBe('Fatema Trading Co (Dwarka)');
    expect(gstSales.placeOfSupply).toBe('Gujarat');
    // Present in the XML but empty: "this company does not record that".
    expect(gstSales.reference).toBe('');
    expect(gstSales.orderRef).toBe('');
    expect(gstSales.paymentTerms).toBe('');
    expect(gstSales.deliveryTerms).toEqual([]);

    // Company B is the exact inverse — order refs and terms, no carrier.
    expect(solar.reference).toBe('P/MKR/0322/341/01');
    expect(solar.referenceDate).toBe('20210714');
    expect(solar.orderRef).toBe('Lead 9480');
    expect(solar.buyerOrderNumber).toBe('PIXM/21-22/05');
    expect(solar.buyerOrderDate).toBe('20210713');
    expect(solar.paymentTerms).toBe('100% Advance Payment');
    expect(solar.deliveryTerms).toEqual([
      '1. Ex-Works',
      '2. Our risk and responsibility ceases as soon as',
      'the goods leave our premises.',
    ]);
    expect(solar.destination).toBe('Ludhiyana');
    // Companies commonly put the vehicle in the vessel field.
    expect(solar.vehicleNumber).toBe('GJ03AZ6791');
    expect(solar.buyerAddress).toEqual(['Village : Khapat', 'Ta. Porbandar']);
    expect(solar.partyGstin).toBe('24BBDPG5288D1ZV');
    expect(solar.partyState).toBe('Gujarat');
    expect(solar.consigneePincode).toBe('362530');
    expect(solar.consigneeGstin).toBe('24BBDPG5288D1ZV');
    expect(solar.dispatchedThrough).toBe('');
  });

  it('reads bank settlement off the bank line only — that is where Tally puts payment type', async () => {
    const receipt = parseVoucherCollection(await load('vouchers-detail.xml'))[2];
    expect(receipt.voucherType).toBe('Receipt');
    expect(receipt.ledgerEntries).toHaveLength(2);

    // BANKALLOCATIONS.LIST holds its fields directly, with no repeated child
    // element — the shape real Tally exports.
    const bank = receipt.ledgerEntries[0];
    expect(bank.ledgerName).toBe('Bank of Baroda');
    expect(bank.bankAllocation?.transactionType).toBe('Cheque/DD');
    expect(bank.bankAllocation?.paymentMode).toBe('Transacted');
    expect(bank.bankAllocation?.instrumentNumber).toBe('328650');
    expect(bank.bankAllocation?.instrumentDate).toBe('20220331');
    expect(bank.bankAllocation?.bankName).toBe('State Bank of India (India)');
    expect(bank.bankAllocation?.paymentFavouring).toBe('Rajesh Sharma');

    // The party line carries an empty allocation node; an empty node is noise,
    // not a settlement, so it must not surface as an object of empty strings.
    expect(receipt.ledgerEntries[1].ledgerName).toBe('Rajesh Sharma');
    expect(receipt.ledgerEntries[1].bankAllocation).toBeUndefined();
  });

  it('still parses a voucher that carries none of the detail fields', async () => {
    const [sales] = parseVoucherCollection(await load('vouchers.xml'));
    expect(sales.reference).toBe('');
    expect(sales.deliveryTerms).toEqual([]);
    expect(sales.buyerAddress).toEqual([]);
    expect(sales.ledgerEntries.every((e) => e.bankAllocation === undefined)).toBe(true);
  });
});

describe('parseVoucherTypeCollection', () => {
  it('parses voucher types collection XML correctly', async () => {
    const xml = `
      <ENVELOPE>
        <BODY>
          <DATA>
            <COLLECTION>
              <VOUCHERTYPE NAME="Sales" PARENT="Sales">
                <NAME>Sales</NAME>
                <PARENT>Sales</PARENT>
              </VOUCHERTYPE>
              <VOUCHERTYPE NAME="GST SALES" PARENT="Sales">
                <NAME>GST SALES</NAME>
                <PARENT>Sales</PARENT>
              </VOUCHERTYPE>
              <VOUCHERTYPE NAME="Purchase" PARENT="Purchase">
                <NAME>Purchase</NAME>
                <PARENT>Purchase</PARENT>
              </VOUCHERTYPE>
            </COLLECTION>
          </DATA>
        </BODY>
      </ENVELOPE>
    `;
    const parsed = await parseStringPromise(xml, { explicitArray: false });
    const types = parseVoucherTypeCollection(parsed);
    expect(types).toHaveLength(3);
    expect(types).toEqual([
      { name: 'GST SALES', parent: 'Sales' },
      { name: 'Purchase', parent: 'Purchase' },
      { name: 'Sales', parent: 'Sales' },
    ]);
  });
});
