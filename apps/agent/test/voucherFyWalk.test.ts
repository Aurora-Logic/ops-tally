import { describe, expect, it } from 'vitest';
import type { CompanyInfo, VoucherJSON, VoucherQueryOptions } from '@opstally/tally-client';
import { AgentDb } from '../src/main/engine/db.js';
import { Poller, type PollerSettings } from '../src/main/engine/poller.js';
import { makeVoucher } from './support/voucher.js';

/**
 * Voucher polling walks the company's financial years, one request each,
 * because Tally cannot scope a voucher collection more finely than a year:
 * asking for a single day returns that day's whole year, and asking for eight
 * years returns one of them. These tests pin the properties that walk depends
 * on — every year gets asked, and the watermark is only trusted once the whole
 * sweep has landed.
 */

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

const voucher = (over: Partial<VoucherJSON> = {}): VoucherJSON =>
  makeVoucher({ date: '20240315', guid: 'g-1', masterId: 'm-1', ...over });

/** A client whose getVouchers is driven by a per-window callback. */
function clientOf(
  onWindow: (opts: VoucherQueryOptions, index: number) => VoucherJSON[],
  startingFrom = '20220401',
) {
  const windows: VoucherQueryOptions[] = [];
  const client = {
    host: 'localhost',
    port: 9000,
    company: 'TestCo',
    listCompanies: async (): Promise<CompanyInfo[]> => [{ name: 'TestCo', startingFrom }],
    getVouchers: async (opts: VoucherQueryOptions): Promise<VoucherJSON[]> => {
      const out = onWindow(opts, windows.length);
      windows.push(opts);
      return out;
    },
    getStockItems: async () => [],
    getLedgers: async () => [],
  } as any;
  return { client, windows };
}

describe('voucher polling walks financial years', () => {
  it('asks every year from books-begin, and carries the watermark into each request', async () => {
    const db = new AgentDb(':memory:');
    db.setMeta('baseline:vouchers', 'done');
    db.setWatermark('vouchers', 500);

    const { client, windows } = clientOf(() => []);
    const poller = new Poller({ db, client, getSettings: () => settings() });
    // start() clears the stopped flag and returns its first sweep.
    await poller.start();
    poller.stop();

    // Books begin 2022-04-01; several years to today. Every window carries the
    // stored watermark, which is what keeps a multi-year sweep affordable —
    // Tally applies the AlterID filter server-side.
    expect(windows.length).toBeGreaterThan(2);
    expect(windows.every((w) => w.alterIdAbove === 500)).toBe(true);

    // Non-overlapping and gapless, oldest first.
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].fromDate.getTime()).toBe(windows[i - 1].toDate.getTime() + 24 * 3600 * 1000);
    }
  }, 30_000);

  it('advances the watermark only after every year has landed', async () => {
    const db = new AgentDb(':memory:');
    db.setMeta('baseline:vouchers', 'done');
    db.setWatermark('vouchers', 10);

    // The second window throws: a sweep that dies part-way must not leave the
    // watermark past years it never asked, or their edits are skipped forever.
    const { client } = clientOf((_opts, i) => {
      if (i === 0) return [voucher({ guid: 'g-early', alterId: 900 })];
      if (i === 1) throw new Error('tally went away mid-sweep');
      return [];
    });

    const poller = new Poller({ db, client, getSettings: () => settings() });
    // start() clears the stopped flag and returns its first sweep.
    await poller.start();
    poller.stop();

    expect(db.getWatermark('vouchers')).toBe(10);
  }, 30_000);

  it('advances to the aggregate max across all years, not the last year seen', async () => {
    const db = new AgentDb(':memory:');
    db.setMeta('baseline:vouchers', 'done');

    // The highest AlterID sits in an OLD year — an old voucher edited today.
    // Taking the final window's max instead of the aggregate would lose it.
    const { client } = clientOf((_opts, i) =>
      i === 0 ? [voucher({ guid: 'g-old-edited', alterId: 4242 })] : [voucher({ guid: `g-${i}`, alterId: 7 + i })],
    );

    const poller = new Poller({ db, client, getSettings: () => settings() });
    // start() clears the stopped flag and returns its first sweep.
    await poller.start();
    poller.stop();

    expect(db.getWatermark('vouchers')).toBe(4242);
  }, 30_000);

  it('discards the sweep and re-baselines when the company was restored from a backup', async () => {
    const db = new AgentDb(':memory:');
    db.setMeta('baseline:vouchers', 'done');
    // Stored watermark far above anything the live company now reports: the
    // books were restored or rewritten, so our snapshots describe records that
    // no longer exist.
    db.setWatermark('vouchers', 999_999);

    const enqueued: any[] = [];
    const { client } = clientOf((_opts, i) => (i === 0 ? [voucher({ guid: 'g-a', alterId: 12 })] : []));
    const poller = new Poller({
      db,
      client,
      getSettings: () => settings(),
      onEvents: (e) => enqueued.push(...e),
    });
    // start() clears the stopped flag and returns its first sweep.
    await poller.start();
    poller.stop();

    // No flood of voucher.created for records the receiver already holds...
    expect(enqueued).toHaveLength(0);
    // ...and the entity is cleared so the next poll re-baselines silently.
    expect(db.getWatermark('vouchers')).toBe(0);
    expect(db.getMeta('baseline:vouchers')).not.toBe('done');
  }, 30_000);

  it('an old year reporting a low max does not by itself trip the regression guard', async () => {
    const db = new AgentDb(':memory:');
    db.setMeta('baseline:vouchers', 'done');
    db.setWatermark('vouchers', 800);

    // Oldest year returns a low AlterID, the current year a high one. Judged
    // per window the first would look like a regression and wipe the entity on
    // every single poll; judged on the aggregate it plainly is not one.
    const { client } = clientOf((_opts, i) =>
      i === 0 ? [voucher({ guid: 'g-old', alterId: 3 })] : i === 1 ? [voucher({ guid: 'g-new', alterId: 1200 })] : [],
    );

    const poller = new Poller({ db, client, getSettings: () => settings() });
    // start() clears the stopped flag and returns its first sweep.
    await poller.start();
    poller.stop();

    expect(db.getWatermark('vouchers')).toBe(1200);
    expect(db.getMeta('baseline:vouchers')).toBe('done');
  }, 30_000);
});
