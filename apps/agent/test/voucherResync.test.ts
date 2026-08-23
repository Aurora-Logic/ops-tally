import { describe, expect, it } from 'vitest';
import type { CompanyInfo, VoucherJSON, VoucherQueryOptions } from '@opstally/tally-client';
import { AgentDb } from '../src/main/engine/db.js';
import { Poller, type PollerSettings } from '../src/main/engine/poller.js';
import { makeVoucher } from './support/voucher.js';

/** Tally's YYYYMMDD from local components — the same reading fmtTallyDate takes. */
function localYmd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

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
          makeVoucher({
            masterId: `m-${n}`,
            alterId: 100 + n,
            guid: `g-${n}`,
            date: '20240315',
            voucherNumber: `INV-${n}`,
          }),
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
    // Compared in LOCAL components, not via toISOString(): the poller builds
    // these dates locally and fmtTallyDate reads them back locally, so the
    // round-trip to Tally is correct. Asserting in UTC shifts the day backwards
    // in any timezone east of Greenwich (IST is +5:30) and fails a correct poller.
    expect(localYmd(requestedWindows[0].fromDate)).toBe('20240301');
    for (let i = 1; i < requestedWindows.length; i++) {
      const prevTo = requestedWindows[i - 1].toDate.getTime();
      const curFrom = requestedWindows[i].fromDate.getTime();
      expect(curFrom).toBe(prevTo + 24 * 3600 * 1000);
    }

    expect(enqueued).toHaveLength(requestedWindows.length);
    expect(enqueued.every((e) => e.event === 'voucher.snapshot')).toBe(true);
    expect(db.getWatermark('vouchers')).toBe(100 + requestedWindows.length);
    // 30s, not the 5s default: the resync deliberately pauses between window
    // requests so Tally's single-threaded gateway is not hammered, and a
    // multi-year fallback walks enough windows to exceed the default.
  }, 30_000);

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
  }, 30_000);

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
