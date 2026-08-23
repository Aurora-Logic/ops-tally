import { describe, expect, it } from 'vitest';
import type { LedgerJSON } from '@opstally/tally-client';
import { AgentDb } from '../src/main/engine/db.js';
import { diffLedgers } from '../src/main/engine/differ.js';
import { Poller, type PollerSettings } from '../src/main/engine/poller.js';

function settings(over: Partial<PollerSettings> = {}): PollerSettings {
  return {
    company: 'TestCo',
    tallyHost: 'localhost',
    tallyPort: 9000,
    paused: false,
    voucherTypes: [],
    intervalsMinutes: { vouchers: 15, stock: 10, ledgers: 30 },
    webhookUrl: 'http://example.test/webhook',
    ...over,
  };
}

function ledger(over: Partial<LedgerJSON> = {}): LedgerJSON {
  return {
    masterId: '1',
    alterId: 100,
    guid: 'g-1',
    name: 'Acme Traders',
    parent: 'Sundry Debtors',
    gstin: '27AABCU9603R1ZM',
    gstRegistrationType: 'Regular',
    openingBalance: 0,
    closingBalance: 1000,
    address: ['Lower Parel'],
    state: 'Maharashtra',
    country: 'India',
    pincode: '400018',
    contactPerson: 'Ravi Menon',
    phone: '022-24001188',
    mobile: '9820011223',
    email: 'accounts@acme.in',
    creditLimit: 500000,
    creditPeriodDays: 45,
    isBillWiseOn: true,
    ...over,
  };
}

function ctx(db: AgentDb, baseline = false) {
  return { db, company: 'TestCo', installId: 'inst-1', baseline };
}

describe('diffLedgers party detail', () => {
  it('emits ledger.updated when only the closing balance moves', () => {
    const db = new AgentDb(':memory:');
    // Baseline pass records the snapshot silently.
    expect(diffLedgers(ctx(db, true), [ledger()])).toHaveLength(0);

    // AlterID deliberately unchanged: Tally does not bump it when a voucher
    // moves the balance, so the hash is the only thing that can catch this.
    const events = diffLedgers(ctx(db), [ledger({ closingBalance: 4250.75 })]);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('ledger.updated');
    expect((events[0].payload as LedgerJSON).closingBalance).toBe(4250.75);
  });

  it('emits nothing when nothing changed', () => {
    const db = new AgentDb(':memory:');
    diffLedgers(ctx(db, true), [ledger()]);
    expect(diffLedgers(ctx(db), [ledger()])).toHaveLength(0);
  });

  it('emits ledger.updated when contact detail changes', () => {
    const db = new AgentDb(':memory:');
    diffLedgers(ctx(db, true), [ledger()]);
    const events = diffLedgers(ctx(db), [ledger({ mobile: '9000000000' })]);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('ledger.updated');
  });
});

describe('Poller.fullLedgerResync', () => {
  it('chunks every ledger into ledger.snapshot events and advances the watermark', async () => {
    const db = new AgentDb(':memory:');
    const ledgers = Array.from({ length: 250 }, (_, i) =>
      ledger({ masterId: String(i), guid: `g-${i}`, name: `Party ${i}`, alterId: 3000 + i })
    );

    const client = {
      host: 'localhost',
      port: 9000,
      company: 'TestCo',
      getLedgers: async (): Promise<LedgerJSON[]> => ledgers,
    } as any;

    const enqueued: any[] = [];
    const poller = new Poller({ db, client, getSettings: () => settings(), onEvents: (e) => enqueued.push(...e) });

    await poller.fullLedgerResync();

    // 250 ledgers at a chunk size of 100.
    expect(enqueued).toHaveLength(3);
    expect(enqueued.every((e) => e.event === 'ledger.snapshot')).toBe(true);
    expect(enqueued.map((e) => e.payload.chunk)).toEqual([1, 2, 3]);
    expect(enqueued.every((e) => e.payload.total_chunks === 3)).toBe(true);
    expect(enqueued.flatMap((e) => e.payload.ledgers)).toHaveLength(250);
    // Party detail rides along in the snapshot, not just the identity fields.
    expect(enqueued[0].payload.ledgers[0].closingBalance).toBe(1000);
    expect(enqueued[0].payload.ledgers[0].parent).toBe('Sundry Debtors');

    expect(db.getWatermark('ledgers')).toBe(3249);
  });

  it('emits nothing for an empty ledger list', async () => {
    const db = new AgentDb(':memory:');
    const client = { host: 'localhost', port: 9000, company: 'TestCo', getLedgers: async () => [] } as any;
    const enqueued: any[] = [];
    const poller = new Poller({ db, client, getSettings: () => settings(), onEvents: (e) => enqueued.push(...e) });

    await poller.fullLedgerResync();
    expect(enqueued).toHaveLength(0);
  });

  it('does nothing when no company is configured', async () => {
    const db = new AgentDb(':memory:');
    let calls = 0;
    const client = {
      host: 'localhost',
      port: 9000,
      company: '',
      getLedgers: async () => {
        calls++;
        return [];
      },
    } as any;

    const poller = new Poller({ db, client, getSettings: () => settings({ company: '' }) });
    await poller.fullLedgerResync();

    expect(calls).toBe(0);
  });
});
