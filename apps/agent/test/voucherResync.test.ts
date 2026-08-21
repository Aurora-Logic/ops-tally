import { describe, expect, it } from 'vitest';
import type { CompanyInfo, VoucherJSON, VoucherQueryOptions } from '@opstally/tally-client';
import { AgentDb } from '../src/main/engine/db.js';
import { Poller, type PollerSettings } from '../src/main/engine/poller.js';

function settings(over: Partial<PollerSettings> = {}): PollerSettings {
  return {
    company: 'TestCo',
    tallyHost: 'localhost',
    tallyPort: 9000,
    paused: false,
    voucherLookbackDays: 90,
    voucherTypes: [],
    intervalsMinutes: { vouchers: 2, stock: 10, ledgers: 30 },
    webhookUrl: 'http://example.test/webhook',
    ...over,
  };
}

describe('Poller.fullVoucherResync', () => {
  it('walks the company history in non-overlapping windows and advances the watermark', async () => {
    const db = new AgentDb(':memory:');
    const requestedWindows: { fromDate: Date; toDate: Date }[] = [];

    const client = {
      host: 'localhost',
      port: 9000,
      company: 'TestCo',
      listCompanies: async (): Promise<CompanyInfo[]> => [{ name: 'TestCo', startingFrom: '20240301' }],
      getVouchers: async (opts: VoucherQueryOptions): Promise<VoucherJSON[]> => {
        requestedWindows.push({ fromDate: opts.fromDate, toDate: opts.toDate });
        const n = requestedWindows.length;
        return [
          {
            masterId: `m-${n}`,
            alterId: 100 + n,
            guid: `g-${n}`,
            date: '20240315',
            voucherType: 'Sales',
            voucherNumber: `INV-${n}`,
            party: 'Acme',
            narration: '',
            isCancelled: false,
            amount: -100,
            ledgerEntries: [],
            inventoryEntries: [],
          },
        ];
      },
    } as any;

    const enqueued: any[] = [];
    const poller = new Poller({
      db,
      client,
      getSettings: () => settings(),
      onEvents: (events) => enqueued.push(...events),
    });

    await poller.fullVoucherResync();

    // "Today" isn't controllable without faking the clock, so assert structural
    // invariants rather than pinning an exact window count: the resync starts
    // exactly at the company's reported books-begin date, and every window
    // butts up against the next with no gap and no overlap.
    expect(requestedWindows.length).toBeGreaterThan(0);
    expect(requestedWindows[0].fromDate.toISOString().slice(0, 10)).toBe('2024-03-01');
    for (let i = 1; i < requestedWindows.length; i++) {
      const prevTo = requestedWindows[i - 1].toDate.getTime();
      const curFrom = requestedWindows[i].fromDate.getTime();
      expect(curFrom).toBe(prevTo + 24 * 3600 * 1000);
    }

    expect(enqueued).toHaveLength(requestedWindows.length);
    expect(enqueued.every((e) => e.event === 'voucher.snapshot')).toBe(true);
    expect(db.getWatermark('vouchers')).toBe(100 + requestedWindows.length);
  });

  it('falls back to a bounded lookback when Tally reports no books-begin date', async () => {
    const db = new AgentDb(':memory:');
    const requestedWindows: { fromDate: Date; toDate: Date }[] = [];

    const client = {
      host: 'localhost',
      port: 9000,
      company: 'TestCo',
      listCompanies: async (): Promise<CompanyInfo[]> => [{ name: 'TestCo' }], // no startingFrom
      getVouchers: async (opts: VoucherQueryOptions): Promise<VoucherJSON[]> => {
        requestedWindows.push({ fromDate: opts.fromDate, toDate: opts.toDate });
        return [];
      },
    } as any;

    const poller = new Poller({ db, client, getSettings: () => settings() });
    await poller.fullVoucherResync();

    expect(requestedWindows.length).toBeGreaterThan(0);
    const spanYears =
      (requestedWindows[requestedWindows.length - 1].toDate.getTime() - requestedWindows[0].fromDate.getTime()) /
      (365 * 24 * 3600 * 1000);
    // Fallback is a fixed number of years back from today — assert a sane range
    // rather than pinning the exact constant.
    expect(spanYears).toBeGreaterThan(10);
    expect(spanYears).toBeLessThan(20);
  });

  it('does nothing when no company is configured', async () => {
    const db = new AgentDb(':memory:');
    let calls = 0;
    const client = {
      host: 'localhost',
      port: 9000,
      company: '',
      listCompanies: async () => {
        calls++;
        return [];
      },
      getVouchers: async () => {
        calls++;
        return [];
      },
    } as any;

    const poller = new Poller({ db, client, getSettings: () => settings({ company: '' }) });
    await poller.fullVoucherResync();

    expect(calls).toBe(0);
  });
});
