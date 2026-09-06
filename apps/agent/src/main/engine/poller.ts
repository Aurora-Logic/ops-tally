import { TallyClient, TallyNotRunningError, TallyBusyError, type VoucherTypeInfo } from '@opstally/tally-client';
import type { AgentDb } from './db.js';
import { getSettings } from '../settings/settings.js';
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

export interface PollerCompany {
  id: string;
  name: string;
  enabled: boolean;
  webhookUrl: string;
  voucherTypes: string[];
  intervalsMinutes: Record<PollEntity, number>;
}

export interface PollerSettings {
  tallyHost: string;
  tallyPort: number;
  paused: boolean;
  companies?: PollerCompany[];
  // Legacy / fallback fields:
  company?: string;
  webhookUrl?: string;
  voucherTypes?: string[];
  intervalsMinutes?: Record<PollEntity, number>;
}

export type PollerState = 'idle' | 'polling' | 'paused' | 'tally_down' | 'error';

export interface PollerStatus {
  state: PollerState;
  lastPollAt?: string;
  message?: string;
}

export interface PollResult {
  ok: boolean;
  totalEvents: number;
  message: string;
  watermarks?: { vouchers: number; stock: number; ledgers: number };
}

export interface PollerDeps {
  db: AgentDb;
  client: TallyClient;
  getSettings: () => PollerSettings;
  /** Called with freshly enqueued events — lets the dispatcher wake immediately. */
  onEvents?: (events: EventEnvelope[]) => void;
  onStatus?: (status: PollerStatus) => void;
  onLog?: (msg: string) => void;
}

const ENTITIES: PollEntity[] = ['vouchers', 'stock', 'ledgers'];

/**
 * Serialized per-entity polling across all enabled Tally companies.
 * Tally's gateway is effectively single-threaded, so all polls run through
 * one promise chain — never two requests in flight.
 */
export class Poller {
  private deps: PollerDeps;
  private timers: ReturnType<typeof setInterval>[] = [];
  private chain: Promise<void> = Promise.resolve();
  private stopped = true;

  constructor(deps: PollerDeps) {
    this.deps = deps;
  }

  /** Normalizes settings into an array of active company targets. */
  private getTargetCompanies(): PollerCompany[] {
    const s = this.deps.getSettings();
    if (Array.isArray(s.companies) && s.companies.length > 0) {
      return s.companies.filter((c) => c.enabled && c.name.trim() !== '');
    }
    if (s.company && s.company.trim() !== '') {
      return [
        {
          id: 'default',
          name: s.company,
          enabled: true,
          webhookUrl: s.webhookUrl ?? '',
          voucherTypes: s.voucherTypes ?? [],
          intervalsMinutes: s.intervalsMinutes ?? { vouchers: 15, stock: 10, ledgers: 30 },
        },
      ];
    }
    return [];
  }

  /** Returns the initial pass, so a caller that needs it can await the first sweep. */
  start(): Promise<void> {
    this.stop();
    this.stopped = false;
    const settings = this.deps.getSettings();
    const companies = this.getTargetCompanies();
    for (const entity of ENTITIES) {
      // Smallest configured interval for this entity among all companies
      const minutes = Math.max(
        1,
        companies.length > 0
          ? Math.min(...companies.map((c) => c.intervalsMinutes[entity] ?? 10))
          : (settings.intervalsMinutes?.[entity] ?? 10)
      );
      this.timers.push(setInterval(() => this.enqueuePoll(entity), minutes * 60_000));
    }
    // Kick off an initial pass after a brief 3s startup grace period (gives Tally time to finish booting)
    const startupTimer = setTimeout(() => {
      if (!this.stopped) void this.pollAll();
    }, 3000);
    this.timers.push(startupTimer as any);
    return this.chain;
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  async pollAll(companyId?: string): Promise<PollResult> {
    const settings = this.deps.getSettings();
    const targetId = companyId || settings.companies?.[0]?.id || 'default';
    for (const entity of ENTITIES) {
      this.enqueuePoll(entity, targetId);
    }
    await this.chain;
    const watermarks = {
      vouchers: this.deps.db.getWatermark(targetId, 'vouchers'),
      stock: this.deps.db.getWatermark(targetId, 'stock'),
      ledgers: this.deps.db.getWatermark(targetId, 'ledgers'),
    };
    const message = watermarks.vouchers > 0
      ? `Sync complete: All data up to date (Voucher Watermark: ${watermarks.vouchers}). 0 new changes detected.`
      : 'Sync complete: Baseline established. All data up to date.';
    return { ok: true, totalEvents: 0, message, watermarks };
  }

  /** Explicitly report Tally liveness (e.g. from user "Test connection" or "Load from Tally"). */
  reportLiveness(ok: boolean, errorMsg?: string): void {
    if (ok) {
      this.deps.onStatus?.({ state: 'idle', lastPollAt: new Date().toISOString(), message: undefined });
      void this.pollAll();
    } else {
      this.deps.onStatus?.({ state: 'tally_down', message: errorMsg ?? 'Tally is not running — please open Tally Prime' });
    }
  }

  /** Queue a poll for one entity onto the serialized chain. */
  enqueuePoll(entity: PollEntity, companyId?: string): Promise<void> {
    this.chain = this.chain.then(() => this.pollOnce(entity, companyId)).catch(() => undefined);
    return this.chain;
  }

  /** Full stock resync — emits chunked stock.snapshot events regardless of diffs. */
  fullStockResync(targetCompanyId?: string): Promise<void> {
    this.chain = this.chain
      .then(async () => {
        const companies = this.getTargetCompanies().filter((c) => !targetCompanyId || c.id === targetCompanyId);
        for (const company of companies) {
          const ctx = this.context(company, false);
          if (!ctx) continue;
          const items = await this.deps.client.getStockItems();
          const events = stockSnapshotEvents(ctx, items);
          for (const e of events) this.deps.db.enqueueEvent(company.id, e);
          if (events.length) this.deps.onEvents?.(events);
          await sleep(150);
        }
      })
      .catch((err) => this.reportError(err));
    return this.chain;
  }

  /**
   * Full ledger resync — emits chunked ledger.snapshot events for every
   * ledger (parties included) regardless of diffs.
   */
  fullLedgerResync(targetCompanyId?: string): Promise<void> {
    this.chain = this.chain
      .then(async () => {
        const companies = this.getTargetCompanies().filter((c) => !targetCompanyId || c.id === targetCompanyId);
        for (const company of companies) {
          const ctx = this.context(company, false);
          if (!ctx) continue;
          const ledgers = await this.deps.client.getLedgers();
          const events = ledgerSnapshotEvents(ctx, ledgers);
          for (const e of events) this.deps.db.enqueueEvent(company.id, e);
          if (events.length) this.deps.onEvents?.(events);

          const maxAlter = maxAlterId(ledgers);
          if (maxAlter > this.deps.db.getWatermark(company.id, 'ledgers')) {
            this.deps.db.setWatermark(company.id, 'ledgers', maxAlter);
          }
          await sleep(150);
        }
      })
      .catch((err) => this.reportError(err));
    return this.chain;
  }

  /**
   * Cached voucher types for a company from SQLite without hitting Tally.
   */
  getVoucherTypes(companyId?: string): { types: VoucherTypeInfo[]; lastVerifiedAt: string | null } {
    const settings = this.deps.getSettings();
    const targetId = companyId || settings.companies?.[0]?.id || 'default';
    return {
      types: this.deps.db.getVoucherTypes(targetId),
      lastVerifiedAt: this.deps.db.getVoucherTypesLastVerifiedAt(targetId),
    };
  }

  /**
   * Force refresh voucher types from Tally Prime for a company and update SQLite.
   */
  async refreshVoucherTypes(targetCompanyId?: string): Promise<{ types: VoucherTypeInfo[]; lastVerifiedAt: string | null }> {
    const settings = this.deps.getSettings();
    const companies = this.getTargetCompanies().filter((c) => !targetCompanyId || c.id === targetCompanyId);
    const company = companies[0] ?? (settings.companies?.find((c) => !targetCompanyId || c.id === targetCompanyId) as PollerCompany | undefined);
    const targetId = targetCompanyId || company?.id || 'default';

    if (!company?.name) {
      return this.getVoucherTypes(targetId);
    }

    this.deps.client.host = settings.tallyHost;
    this.deps.client.port = settings.tallyPort;
    this.deps.client.company = company.name;
    const types = await this.deps.client.getVoucherTypes();
    if (types.length > 0) {
      this.deps.db.saveVoucherTypes(targetId, types);
      this.deps.onLog?.(`[poller] refreshed ${types.length} voucher types from Tally for "${company.name}"`);
    }
    return {
      types: this.deps.db.getVoucherTypes(targetId),
      lastVerifiedAt: this.deps.db.getVoucherTypesLastVerifiedAt(targetId),
    };
  }

  /**
   * Idle-queue verification: When the delivery queue has 0 pending items, verify
   * voucher types against Tally Prime if the verification interval has elapsed.
   */
  private async verifyVoucherTypesIfDue(company: PollerCompany): Promise<void> {
    try {
      // Check if delivery queue is idle
      if (this.deps.db.queueStats(company.id).pending > 0) return;

      const lastVerified = this.deps.db.getVoucherTypesLastVerifiedAt(company.id);
      const days = getSettings().voucherTypesVerificationDays ?? 7;
      const intervalMs = Math.max(1, days) * 86_400_000;
      const now = Date.now();

      if (!lastVerified || now - new Date(lastVerified).getTime() >= intervalMs) {
        this.deps.client.company = company.name;
        const types = await this.deps.client.getVoucherTypes();
        if (types.length > 0) {
          this.deps.db.saveVoucherTypes(company.id, types);
          this.deps.onLog?.(`[poller] idle-queue verified ${types.length} voucher types for "${company.name}" (interval: ${days}d)`);
        }
      }
    } catch (err) {
      // Background verification error is non-fatal
      this.deps.onLog?.(`[poller] background voucher types verification for "${company.name}" skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Full voucher resync — walks the company's entire history in
   * non-overlapping date windows (default 12 months), emitting chunked
   * voucher.snapshot events per window regardless of diffs.
   */
  fullVoucherResync(targetCompanyId?: string): Promise<void> {
    this.chain = this.chain
      .then(async () => {
        const companies = this.getTargetCompanies().filter((c) => !targetCompanyId || c.id === targetCompanyId);
        for (const company of companies) {
          const ctx = this.context(company, false);
          if (!ctx) continue;

          const toDate = new Date();
          const fromDate = await this.resolveVoucherResyncStart(company.name, toDate);
          const windows = dateWindows(fromDate, toDate, RESYNC_WINDOW_MONTHS);

          let maxAlter = 0;
          for (let i = 0; i < windows.length; i++) {
            const { from, to } = windows[i];
            const vouchers = await this.deps.client.getVouchers({
              fromDate: from,
              toDate: to,
              voucherTypes: company.voucherTypes,
            });
            const events = voucherSnapshotEvents(ctx, vouchers);
            for (const e of events) this.deps.db.enqueueEvent(company.id, e);
            if (events.length) this.deps.onEvents?.(events);
            for (const v of vouchers) if (v.alterId > maxAlter) maxAlter = v.alterId;
            if (i < windows.length - 1) await sleep(RESYNC_BATCH_DELAY_MS);
          }

          if (maxAlter > this.deps.db.getWatermark(company.id, 'vouchers')) {
            this.deps.db.setWatermark(company.id, 'vouchers', maxAlter);
          }
          await sleep(150);
        }
      })
      .catch((err) => this.reportError(err));
    return this.chain;
  }

  /** Company's books-begin date from Tally when available, else a safe fallback. */
  private async resolveVoucherResyncStart(companyName: string, toDate: Date): Promise<Date> {
    try {
      const companies = await this.deps.client.listCompanies();
      const match = companies.find((c) => c.name === companyName);
      const parsed = parseTallyDateStr(match?.startingFrom);
      if (parsed) return parsed;
    } catch {
      // Fall through to fallback
    }
    const fallback = new Date(toDate);
    fallback.setFullYear(fallback.getFullYear() - RESYNC_FALLBACK_YEARS);
    return fallback;
  }

  private context(company: PollerCompany, baseline: boolean): DifferContext | undefined {
    const settings = this.deps.getSettings();
    if (!company.name) return undefined;
    this.deps.client.host = settings.tallyHost;
    this.deps.client.port = settings.tallyPort;
    this.deps.client.company = company.name;
    return {
      db: this.deps.db,
      company: company.name,
      companyId: company.id,
      installId: this.deps.db.installId(),
      baseline,
    };
  }

  private async pollOnce(entity: PollEntity, targetCompanyId?: string): Promise<void> {
    if (this.stopped) return;
    const settings = this.deps.getSettings();
    if (settings.paused) {
      this.deps.onStatus?.({ state: 'paused' });
      return;
    }

    const allCompanies = this.getTargetCompanies();
    const companies = allCompanies.filter((c) => !targetCompanyId || c.id === targetCompanyId);

    // If no company has a webhook configured at all, run reachability check
    if (allCompanies.length === 0 || !allCompanies.some((c) => c.webhookUrl)) {
      if (entity === 'vouchers') await this.healthCheck(settings);
      return;
    }

    if (companies.length === 0) {
      return;
    }

    // Safety guard: Check if Tally Prime is running and query which companies are currently loaded in Tally.
    // Querying an uninitialized or closed company in Tally causes a C++ Access Violation in tally.exe.
    let loadedCompanies: string[] = [];
    try {
      this.deps.client.host = settings.tallyHost;
      this.deps.client.port = settings.tallyPort;
      const list = await this.deps.client.listCompanies();
      loadedCompanies = list.map((c) => c.name.trim());
    } catch (err: any) {
      this.reportError(err);
      return;
    }

    this.deps.onStatus?.({ state: 'polling' });
    try {
      for (const company of companies) {
        if (!company.webhookUrl) {
          this.deps.onLog?.(`[poller] skipped "${company.name}" (no webhookUrl configured)`);
          continue;
        }

        const matchName = loadedCompanies.find((lc) => lc.toLowerCase() === company.name.trim().toLowerCase());
        // If company is not yet opened in Tally Prime, skip safely
        if (!matchName) {
          this.deps.onLog?.(`[poller] skipped "${company.name}" (not loaded in Tally Prime; loaded: ${loadedCompanies.join(', ') || 'none'})`);
          continue;
        }

        const baselineKey = `baseline:${company.id}:${entity}`;
        const isBaseline = this.deps.db.getMeta(baselineKey) !== 'done';
        const ctx = this.context(company, isBaseline);
        if (!ctx) continue;

        let events: EventEnvelope[] = [];
        let didReset = false;
        if (entity === 'vouchers') {
          const swept = await this.pollVouchers(ctx, company);
          events = swept.events;
          didReset = swept.didReset;
          this.deps.onLog?.(`[poller] vouchers for "${company.name}": watermark ${this.deps.db.getWatermark(company.id, 'vouchers')}, ${events.length} event(s) emitted (baseline: ${isBaseline})`);
        } else if (entity === 'stock') {
          const items = await this.deps.client.getStockItems();
          events = diffStock(ctx, items);
          this.deps.onLog?.(`[poller] stock for "${company.name}": checked ${items.length} item(s), ${events.length} event(s) emitted (baseline: ${isBaseline})`);
        } else {
          const ledgers = await this.deps.client.getLedgers();
          events = diffLedgers(ctx, ledgers);
          this.deps.onLog?.(`[poller] ledgers for "${company.name}": checked ${ledgers.length} ledger(s), ${events.length} event(s) emitted (baseline: ${isBaseline})`);
        }

        // A reset wiped the baseline marker on purpose — leave it wiped.
        if (!didReset) this.deps.db.setMeta(baselineKey, 'done');
        for (const e of events) this.deps.db.enqueueEvent(company.id, e);
        if (events.length) this.deps.onEvents?.(events);

        // Verify voucher types in the background when the delivery queue is idle
        await this.verifyVoucherTypesIfDue(company);

        // Small pacing delay between company queries to prevent overloading Tally's memory manager
        await sleep(150);
      }
      this.deps.onStatus?.({ state: 'idle', lastPollAt: new Date().toISOString() });
    } catch (err: any) {
      this.reportError(err);
    }
  }

  /** Poll vouchers across the company's whole history, one financial year per request. */
  private async pollVouchers(
    ctx: DifferContext,
    company: PollerCompany
  ): Promise<{ events: EventEnvelope[]; didReset: boolean }> {
    const watermark = this.deps.db.getWatermark(company.id, 'vouchers');
    const toDate = new Date();
    const fromDate = await this.resolveVoucherResyncStart(company.name, toDate);
    const windows = dateWindows(fromDate, toDate, RESYNC_WINDOW_MONTHS);

    const events: EventEnvelope[] = [];
    let liveMax = 0;

    for (let i = 0; i < windows.length; i++) {
      const { from, to } = windows[i];
      const vouchers = await this.deps.client.getVouchers({
        fromDate: from,
        toDate: to,
        alterIdAbove: watermark > 0 ? watermark : undefined,
        voucherTypes: company.voucherTypes,
      });
      const batchMax = maxAlterId(vouchers);
      if (batchMax > liveMax) liveMax = batchMax;
      events.push(...diffVouchers(ctx, vouchers, { windowed: true }));
      if (i < windows.length - 1) await sleep(RESYNC_BATCH_DELAY_MS);
    }

    if (isWatermarkRegression(this.deps.db, 'vouchers', liveMax, company.id)) {
      this.deps.db.clearEntity(company.id, 'vouchers');
      return { events: [], didReset: true };
    }

    if (liveMax > this.deps.db.getWatermark(company.id, 'vouchers')) {
      this.deps.db.setWatermark(company.id, 'vouchers', liveMax);
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
