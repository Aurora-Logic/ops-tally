import { TallyClient, TallyNotRunningError, TallyBusyError } from '@opstally/tally-client';
import type { AgentDb } from './db.js';
import {
  diffLedgers,
  diffStock,
  diffVouchers,
  isWatermarkRegression,
  ledgerSnapshotEvents,
  maxAlterId,
  stockSnapshotEvents,
  voucherSnapshotEvents,
  type DifferContext,
} from './differ.js';
import type { EventEnvelope } from './events.js';

/** Full voucher resync walks this many months per Tally request. */
const RESYNC_WINDOW_MONTHS = 12;
/** Pause between resync requests so Tally's single-threaded gateway isn't hammered. */
const RESYNC_BATCH_DELAY_MS = 400;
/** Fallback lookback when Tally doesn't report the company's books-begin date. */
const RESYNC_FALLBACK_YEARS = 15;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse Tally's StartingFrom date (YYYYMMDD) into a Date, if present and well-formed. */
function parseTallyDateStr(s: string | undefined): Date | undefined {
  if (!s || s.length !== 8) return undefined;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Non-overlapping [from, to] date windows covering the full range, oldest first. */
function dateWindows(from: Date, to: Date, months: number): { from: Date; to: Date }[] {
  const windows: { from: Date; to: Date }[] = [];
  let start = new Date(from);
  while (start <= to) {
    const end = new Date(start);
    end.setMonth(end.getMonth() + months);
    end.setDate(end.getDate() - 1);
    windows.push({ from: start, to: end > to ? to : end });
    start = new Date(end);
    start.setDate(start.getDate() + 1);
  }
  return windows;
}

export type PollEntity = 'vouchers' | 'stock' | 'ledgers';

export interface PollerSettings {
  company: string;
  tallyHost: string;
  tallyPort: number;
  paused: boolean;
  /** Only these voucher types are fetched from Tally at all. Empty means no restriction. */
  voucherTypes: string[];
  intervalsMinutes: Record<PollEntity, number>;
  webhookUrl: string;
}

export type PollerState = 'idle' | 'polling' | 'paused' | 'tally_down' | 'error';

export interface PollerStatus {
  state: PollerState;
  lastPollAt?: string;
  message?: string;
}

export interface PollerDeps {
  db: AgentDb;
  client: TallyClient;
  getSettings: () => PollerSettings;
  /** Called with freshly enqueued events — lets the dispatcher wake immediately. */
  onEvents?: (events: EventEnvelope[]) => void;
  onStatus?: (status: PollerStatus) => void;
}

const ENTITIES: PollEntity[] = ['vouchers', 'stock', 'ledgers'];

/**
 * Serialized per-entity polling. Tally's gateway is effectively single-threaded,
 * so all polls run through one promise chain — never two requests in flight.
 */
export class Poller {
  private deps: PollerDeps;
  private timers: ReturnType<typeof setInterval>[] = [];
  private chain: Promise<void> = Promise.resolve();
  private stopped = true;

  constructor(deps: PollerDeps) {
    this.deps = deps;
  }

  /** Returns the initial pass, so a caller that needs it can await the first sweep. */
  start(): Promise<void> {
    this.stop();
    this.stopped = false;
    const settings = this.deps.getSettings();
    for (const entity of ENTITIES) {
      const minutes = Math.max(1, settings.intervalsMinutes[entity] ?? 10);
      this.timers.push(setInterval(() => this.enqueuePoll(entity), minutes * 60_000));
    }
    // Kick off an immediate first pass.
    return this.pollAll();
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  pollAll(): Promise<void> {
    for (const entity of ENTITIES) this.enqueuePoll(entity);
    return this.chain;
  }

  /** Queue a poll for one entity onto the serialized chain. */
  enqueuePoll(entity: PollEntity): Promise<void> {
    this.chain = this.chain.then(() => this.pollOnce(entity)).catch(() => undefined);
    return this.chain;
  }

  /** Full stock resync — emits chunked stock.snapshot events regardless of diffs. */
  fullStockResync(): Promise<void> {
    this.chain = this.chain
      .then(async () => {
        const ctx = this.context(false);
        if (!ctx) return;
        const items = await this.deps.client.getStockItems();
        const events = stockSnapshotEvents(ctx, items);
        for (const e of events) this.deps.db.enqueueEvent(e);
        if (events.length) this.deps.onEvents?.(events);
      })
      .catch((err) => this.reportError(err));
    return this.chain;
  }

  /**
   * Full ledger resync — emits chunked ledger.snapshot events for every
   * ledger (parties included) regardless of diffs. Unlike vouchers there is no
   * date dimension to walk: Tally returns the whole account list in one
   * request, so this is a single fetch. Also advances the ledger watermark so
   * a later poll doesn't re-baseline off a stale value.
   */
  fullLedgerResync(): Promise<void> {
    this.chain = this.chain
      .then(async () => {
        const ctx = this.context(false);
        if (!ctx) return;
        const ledgers = await this.deps.client.getLedgers();
        const events = ledgerSnapshotEvents(ctx, ledgers);
        for (const e of events) this.deps.db.enqueueEvent(e);
        if (events.length) this.deps.onEvents?.(events);

        const maxAlter = maxAlterId(ledgers);
        if (maxAlter > this.deps.db.getWatermark('ledgers')) this.deps.db.setWatermark('ledgers', maxAlter);
      })
      .catch((err) => this.reportError(err));
    return this.chain;
  }

  /**
   * Full voucher resync — walks the company's entire history in
   * non-overlapping date windows (default 12 months), emitting chunked
   * voucher.snapshot events per window regardless of diffs. Requests run
   * strictly sequentially with a short delay between them (on top of the
   * existing serialized `chain`) since a multi-year backfill against Tally's
   * single-threaded gateway must not hammer it.
   */
  fullVoucherResync(): Promise<void> {
    this.chain = this.chain
      .then(async () => {
        const ctx = this.context(false);
        if (!ctx) return;
        const settings = this.deps.getSettings();

        const toDate = new Date();
        const fromDate = await this.resolveVoucherResyncStart(settings, toDate);
        const windows = dateWindows(fromDate, toDate, RESYNC_WINDOW_MONTHS);

        let maxAlter = 0;
        for (let i = 0; i < windows.length; i++) {
          const { from, to } = windows[i];
          const vouchers = await this.deps.client.getVouchers({
            fromDate: from,
            toDate: to,
            voucherTypes: settings.voucherTypes,
          });
          const events = voucherSnapshotEvents(ctx, vouchers);
          for (const e of events) this.deps.db.enqueueEvent(e);
          if (events.length) this.deps.onEvents?.(events);
          for (const v of vouchers) if (v.alterId > maxAlter) maxAlter = v.alterId;
          if (i < windows.length - 1) await sleep(RESYNC_BATCH_DELAY_MS);
        }

        if (maxAlter > this.deps.db.getWatermark('vouchers')) this.deps.db.setWatermark('vouchers', maxAlter);
      })
      .catch((err) => this.reportError(err));
    return this.chain;
  }

  /** Company's books-begin date from Tally when available, else a safe fallback. */
  private async resolveVoucherResyncStart(settings: PollerSettings, toDate: Date): Promise<Date> {
    try {
      const companies = await this.deps.client.listCompanies();
      const match = companies.find((c) => c.name === settings.company);
      const parsed = parseTallyDateStr(match?.startingFrom);
      if (parsed) return parsed;
    } catch {
      // Fall through to the fallback below — a failed probe shouldn't block the resync.
    }
    const fallback = new Date(toDate);
    fallback.setFullYear(fallback.getFullYear() - RESYNC_FALLBACK_YEARS);
    return fallback;
  }

  private context(baseline: boolean): DifferContext | undefined {
    const settings = this.deps.getSettings();
    if (!settings.company) return undefined;
    // Company switch invalidates all snapshots and watermarks.
    const prevCompany = this.deps.db.getMeta('company');
    if (prevCompany && prevCompany !== settings.company) this.deps.db.resetSyncState();
    this.deps.db.setMeta('company', settings.company);
    this.deps.client.host = settings.tallyHost;
    this.deps.client.port = settings.tallyPort;
    this.deps.client.company = settings.company;
    return {
      db: this.deps.db,
      company: settings.company,
      installId: this.deps.db.installId(),
      baseline,
    };
  }

  private async pollOnce(entity: PollEntity): Promise<void> {
    if (this.stopped) return;
    const settings = this.deps.getSettings();
    if (settings.paused) {
      this.deps.onStatus?.({ state: 'paused' });
      return;
    }

    // No webhook configured yet — nothing to deliver to, so skip the heavy
    // entity pulls entirely. Only do a cheap reachability probe, and only on
    // one of the three timers so we're not tripling even that.
    if (!settings.webhookUrl) {
      if (entity === 'vouchers') await this.healthCheck(settings);
      return;
    }

    const baselineKey = `baseline:${entity}`;
    const isBaseline = this.deps.db.getMeta(baselineKey) !== 'done';
    const ctx = this.context(isBaseline);
    if (!ctx) return;

    this.deps.onStatus?.({ state: 'polling' });
    try {
      let events: EventEnvelope[] = [];
      let didReset = false;
      if (entity === 'vouchers') {
        const swept = await this.pollVouchers(ctx, settings);
        events = swept.events;
        didReset = swept.didReset;
      } else if (entity === 'stock') {
        const items = await this.deps.client.getStockItems();
        events = diffStock(ctx, items);
      } else {
        const ledgers = await this.deps.client.getLedgers();
        events = diffLedgers(ctx, ledgers);
      }

      // A reset wiped the baseline marker on purpose — leave it wiped.
      if (!didReset) this.deps.db.setMeta(baselineKey, 'done');
      for (const e of events) this.deps.db.enqueueEvent(e);
      if (events.length) this.deps.onEvents?.(events);
      this.deps.onStatus?.({ state: 'idle', lastPollAt: new Date().toISOString() });
    } catch (err: any) {
      this.reportError(err);
    }
  }

  /**
   * Poll vouchers across the company's whole history, one financial year per
   * request.
   *
   * Why a walk rather than one dated request: Tally scopes a Voucher
   * collection to the FINANCIAL YEAR containing the requested range, not to
   * the range. Asking for 2018-04-01..2026-08-23 returns one year, and asking
   * for a single day returns that day's whole year. There is no such thing as
   * a narrow voucher fetch, so the only way to see every year is to ask for
   * each one.
   *
   * Why that is affordable: the AlterID filter is applied by Tally, not here.
   * Measured on a real company, one financial year of 17,144 vouchers is 82 MB
   * unfiltered and 1.5 KB once `AlterID > watermark` is attached. Steady state
   * is therefore N tiny responses. It still costs Tally real scan time per year
   * (~9s on that company even when nothing matches), which is why the default
   * voucher interval is minutes, not seconds, and why the requests are spaced.
   *
   * Requests run strictly sequentially with a pause between them, on top of
   * the poller's own serialized chain — a multi-year sweep must not hammer
   * Tally's single-threaded gateway.
   */
  private async pollVouchers(
    ctx: DifferContext,
    settings: PollerSettings
  ): Promise<{ events: EventEnvelope[]; didReset: boolean }> {
    const watermark = this.deps.db.getWatermark('vouchers');
    const toDate = new Date();
    const fromDate = await this.resolveVoucherResyncStart(settings, toDate);
    const windows = dateWindows(fromDate, toDate, RESYNC_WINDOW_MONTHS);

    const events: EventEnvelope[] = [];
    let liveMax = 0;

    for (let i = 0; i < windows.length; i++) {
      const { from, to } = windows[i];
      const vouchers = await this.deps.client.getVouchers({
        fromDate: from,
        toDate: to,
        alterIdAbove: watermark > 0 ? watermark : undefined,
        voucherTypes: settings.voucherTypes,
      });
      const batchMax = maxAlterId(vouchers);
      if (batchMax > liveMax) liveMax = batchMax;
      // `windowed`: this window owns neither the regression guard nor the
      // watermark — see diffVouchers for why both are wrong per window.
      events.push(...diffVouchers(ctx, vouchers, { windowed: true }));
      if (i < windows.length - 1) await sleep(RESYNC_BATCH_DELAY_MS);
    }

    /*
     * The regression check, asked once, about the aggregate: a live max below
     * our stored watermark means the company was restored from a backup or
     * rewritten, and our snapshots describe books that no longer exist.
     * Discard this sweep's events rather than delivering a flood of
     * "created" for records the receiver already has, and clear the entity so
     * the next poll re-baselines silently. Checked after the walk because the
     * true company max is not known until every year has been asked.
     */
    if (isWatermarkRegression(this.deps.db, 'vouchers', liveMax)) {
      this.deps.db.clearEntity('vouchers');
      // didReset matters: clearEntity drops the `baseline:vouchers` marker, and
      // the caller must NOT put it back. If it did, the next poll would run in
      // non-baseline mode against snapshots we just emptied, and every voucher
      // in the company would look new — the exact flood this guard exists to
      // prevent, arriving one poll later.
      return { events: [], didReset: true };
    }

    if (liveMax > this.deps.db.getWatermark('vouchers')) {
      this.deps.db.setWatermark('vouchers', liveMax);
    }
    return { events, didReset: false };
  }

  /** Cheap liveness probe (company list only) used while no webhook is set. */
  private async healthCheck(settings: PollerSettings): Promise<void> {
    this.deps.client.host = settings.tallyHost;
    this.deps.client.port = settings.tallyPort;
    try {
      await this.deps.client.testConnection();
      this.deps.onStatus?.({
        state: 'idle',
        lastPollAt: new Date().toISOString(),
        message: 'Tally reachable — webhook not configured, sync disabled',
      });
    } catch (err) {
      this.reportError(err);
    }
  }

  private reportError(err: any): void {
    if (err instanceof TallyNotRunningError || err instanceof TallyBusyError) {
      this.deps.onStatus?.({ state: 'tally_down', message: err.message });
    } else {
      this.deps.onStatus?.({ state: 'error', message: err?.message ?? String(err) });
    }
  }
}
