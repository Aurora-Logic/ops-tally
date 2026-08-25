import { createHash } from 'node:crypto';
import type { LedgerJSON, StockItemJSON, VoucherJSON } from '@opstally/tally-client';
import type { AgentDb } from './db.js';
import { makeEnvelope, type EventEnvelope, type TallyEventName } from './events.js';

function hashOf(obj: unknown): string {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

/**
 * Highest AlterID in a batch, by loop rather than `Math.max(0, ...list)`.
 * Spreading passes one argument per element, and a financial year of vouchers
 * is comfortably past the ~100k argument limit that throws RangeError.
 */
export function maxAlterId(records: readonly { alterId: number }[]): number {
  let max = 0;
  for (const r of records) if (r.alterId > max) max = r.alterId;
  return max;
}

/**
 * True when the live max AlterID has fallen BELOW the stored watermark — the
 * company was restored from a backup or rewritten. Exposed so the financial-
 * year walker can ask the question once, about the aggregate, rather than once
 * per window.
 */
export function isWatermarkRegression(db: AgentDb, entity: string, liveMax: number, companyId = 'default'): boolean {
  const stored = db.getWatermark(companyId, entity);
  return stored > 0 && liveMax > 0 && liveMax < stored;
}

export interface DifferContext {
  db: AgentDb;
  company: string;
  companyId?: string;
  installId: string;
  /** Baseline mode: record snapshots but emit no events (first run). */
  baseline: boolean;
}

/**
 * Generic snapshot diff: returns created/updated envelopes and records
 * the new snapshots. Records without a usable key are skipped.
 */
function diffRecords<T>(
  ctx: DifferContext,
  entity: string,
  records: T[],
  keyOf: (r: T) => string,
  hashPayload: (r: T) => unknown,
  createdEvent: TallyEventName | null,
  updatedEvent: TallyEventName
): EventEnvelope[] {
  const events: EventEnvelope[] = [];
  const cid = ctx.companyId ?? 'default';
  const tx = ctx.db.db.transaction(() => {
    for (const rec of records) {
      const key = keyOf(rec);
      if (!key) continue;
      const hash = hashOf(hashPayload(rec));
      const prev = ctx.db.getSnapshot(cid, entity, key);
      if (!prev) {
        ctx.db.putSnapshot(cid, entity, key, hash, JSON.stringify(rec));
        if (!ctx.baseline && createdEvent) {
          events.push(makeEnvelope(createdEvent, rec, ctx.company, ctx.installId));
        } else if (!ctx.baseline && !createdEvent) {
          events.push(makeEnvelope(updatedEvent, rec, ctx.company, ctx.installId));
        }
      } else if (prev.hash !== hash) {
        ctx.db.putSnapshot(cid, entity, key, hash, JSON.stringify(rec));
        if (!ctx.baseline) {
          events.push(makeEnvelope(updatedEvent, rec, ctx.company, ctx.installId));
        }
      }
    }
  });
  tx();
  return events;
}

/**
 * Vouchers: ALTERID watermark upstream narrows the fetch; here we classify
 * created vs updated vs cancelled against per-GUID snapshots.
 *
 * `windowed` says this batch is one window of a multi-request walk over the
 * company's financial years, and that the CALLER owns both the regression
 * guard and the watermark. Both are wrong to do per window:
 *
 * - The guard asks "is the live max AlterID below our stored watermark?" That
 *   is only meaningful about the whole company. An old year's batch always has
 *   a lower max, so letting it answer would wipe and re-baseline on every poll
 *   and the watermark would never stick.
 * - Advancing the watermark per window would strand the years not yet walked:
 *   if the sweep fails at year four of eight, a watermark already moved to the
 *   current year's max means the next poll skips changes in years five to
 *   eight forever. The walker advances it once, only after every year lands.
 *
 * See Poller.pollVouchers.
 */
export function diffVouchers(
  ctx: DifferContext,
  vouchers: VoucherJSON[],
  opts: { windowed?: boolean } = {}
): EventEnvelope[] {
  const entity = 'vouchers';
  const cid = ctx.companyId ?? 'default';
  const wasReset =
    opts.windowed === true ? false : guardWatermarkRegression(ctx, entity, maxAlterId(vouchers));
  if (wasReset) ctx = { ...ctx, baseline: true };

  const events: EventEnvelope[] = [];
  const tx = ctx.db.db.transaction(() => {
    for (const v of vouchers) {
      const key = v.guid || v.masterId;
      if (!key) continue;
      const hash = hashOf(v);
      const prev = ctx.db.getSnapshot(cid, entity, key);
      const wasCancelled = prev ? (JSON.parse(prev.payload_json) as VoucherJSON).isCancelled : false;
      if (!prev) {
        ctx.db.putSnapshot(cid, entity, key, hash, JSON.stringify(v));
        if (!ctx.baseline) {
          events.push(
            makeEnvelope(v.isCancelled ? 'voucher.cancelled' : 'voucher.created', v, ctx.company, ctx.installId)
          );
        }
      } else if (prev.hash !== hash) {
        ctx.db.putSnapshot(cid, entity, key, hash, JSON.stringify(v));
        if (!ctx.baseline) {
          const name: TallyEventName =
            v.isCancelled && !wasCancelled ? 'voucher.cancelled' : 'voucher.updated';
          events.push(makeEnvelope(name, v, ctx.company, ctx.installId));
        }
      }
    }
  });
  tx();

  if (opts.windowed !== true) {
    const maxAlter = maxAlterId(vouchers);
    if (maxAlter > ctx.db.getWatermark(cid, entity)) ctx.db.setWatermark(cid, entity, maxAlter);
  }
  return events;
}

/**
 * Stock: hash-diff on the fields consumers care about — ClosingBalance is a
 * computed value, so the item's ALTERID does not move when a voucher changes it.
 */
export function diffStock(ctx: DifferContext, items: StockItemJSON[]): EventEnvelope[] {
  const entity = 'stock';
  const cid = ctx.companyId ?? 'default';
  const wasReset = guardWatermarkRegression(ctx, entity, maxAlterId(items));
  if (wasReset) ctx = { ...ctx, baseline: true };
  const events = diffRecords(
    ctx,
    entity,
    items,
    (i) => i.guid || i.masterId || i.name,
    (i) => ({ qty: i.closingQty, unit: i.baseUnits, sale: i.salePrice, cost: i.costPrice, name: i.name, parent: i.parent }),
    null, // new stock items also arrive as stock.updated — consumers upsert
    'stock.updated'
  );
  const maxAlter = maxAlterId(items);
  if (maxAlter > ctx.db.getWatermark(cid, entity)) ctx.db.setWatermark(cid, entity, maxAlter);
  return events;
}

/**
 * Ledgers (parties are the ones under Sundry Debtors/Creditors). The hash
 * covers the party detail fields as well as the identity ones — closingBalance
 * especially, which Tally computes from the vouchers and therefore changes
 * WITHOUT the ledger's AlterID moving (same trap as stock's closing quantity).
 * Leaving it out of the hash would ship an outstanding figure that only ever
 * refreshed when someone renamed the account.
 */
export function diffLedgers(ctx: DifferContext, ledgers: LedgerJSON[]): EventEnvelope[] {
  const entity = 'ledgers';
  const cid = ctx.companyId ?? 'default';
  const wasReset = guardWatermarkRegression(ctx, entity, maxAlterId(ledgers));
  if (wasReset) ctx = { ...ctx, baseline: true };
  const events = diffRecords(
    ctx,
    entity,
    ledgers,
    (l) => l.guid || l.masterId || l.name,
    (l) => ({
      name: l.name,
      parent: l.parent,
      gstin: l.gstin,
      gstRegistrationType: l.gstRegistrationType,
      openingBalance: l.openingBalance,
      closingBalance: l.closingBalance,
      address: l.address,
      state: l.state,
      country: l.country,
      pincode: l.pincode,
      contactPerson: l.contactPerson,
      phone: l.phone,
      mobile: l.mobile,
      email: l.email,
      creditLimit: l.creditLimit,
      creditPeriodDays: l.creditPeriodDays,
      isBillWiseOn: l.isBillWiseOn,
    }),
    'ledger.created',
    'ledger.updated'
  );
  const maxAlter = maxAlterId(ledgers);
  if (maxAlter > ctx.db.getWatermark(cid, entity)) ctx.db.setWatermark(cid, entity, maxAlter);
  return events;
}

/**
 * If the live max AlterID has moved BELOW our stored watermark, the company
 * was restored from a backup or rewritten — our state is stale. Reset the
 * entity (and vouchers, which share the company's AlterID space) to re-baseline.
 * Returns true when a reset happened so the caller re-baselines silently.
 */
function guardWatermarkRegression(ctx: DifferContext, entity: string, liveMax: number): boolean {
  const cid = ctx.companyId ?? 'default';
  const stored = ctx.db.getWatermark(cid, entity);
  if (stored > 0 && liveMax > 0 && liveMax < stored) {
    ctx.db.clearEntity(cid, entity);
    ctx.db.clearEntity(cid, 'vouchers');
    return true;
  }
  return false;
}

/**
 * Chunk one date-window's voucher batch into voucher.snapshot events (manual
 * full resync). Called once per window by fullVoucherResync — the resync
 * walks multiple non-overlapping date windows to avoid one multi-year
 * request, so chunk/total_chunks are scoped to this window's own batch.
 */
export function voucherSnapshotEvents(
  ctx: DifferContext,
  vouchers: VoucherJSON[],
  chunkSize = 50
): EventEnvelope[] {
  const events: EventEnvelope[] = [];
  for (let i = 0; i < vouchers.length; i += chunkSize) {
    events.push(
      makeEnvelope(
        'voucher.snapshot',
        { vouchers: vouchers.slice(i, i + chunkSize), chunk: Math.floor(i / chunkSize) + 1, total_chunks: Math.ceil(vouchers.length / chunkSize) },
        ctx.company,
        ctx.installId
      )
    );
  }
  return events;
}

/**
 * Chunk the full ledger list into ledger.snapshot events (manual full resync).
 * Ledger rows are small and the receiver upserts row-by-row, so this uses the
 * same conservative chunk size as stock rather than the voucher one.
 */
export function ledgerSnapshotEvents(
  ctx: DifferContext,
  ledgers: LedgerJSON[],
  chunkSize = 100
): EventEnvelope[] {
  const events: EventEnvelope[] = [];
  for (let i = 0; i < ledgers.length; i += chunkSize) {
    events.push(
      makeEnvelope(
        'ledger.snapshot',
        {
          ledgers: ledgers.slice(i, i + chunkSize),
          chunk: Math.floor(i / chunkSize) + 1,
          total_chunks: Math.ceil(ledgers.length / chunkSize),
        },
        ctx.company,
        ctx.installId
      )
    );
  }
  return events;
}

/** Chunk a full stock set into stock.snapshot events (manual full resync). */
export function stockSnapshotEvents(
  ctx: DifferContext,
  items: StockItemJSON[],
  // Receiver upserts row-by-row (3 sequential DB round trips each); 500 rows
  // over a slow link runs into the webhook's 30s response budget and gets
  // aborted mid-flight. 100 keeps each chunk comfortably under it.
  chunkSize = 100
): EventEnvelope[] {
  const events: EventEnvelope[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    events.push(
      makeEnvelope(
        'stock.snapshot',
        { items: items.slice(i, i + chunkSize), chunk: Math.floor(i / chunkSize) + 1, total_chunks: Math.ceil(items.length / chunkSize) },
        ctx.company,
        ctx.installId
      )
    );
  }
  return events;
}
