import { createHash } from 'node:crypto';
import type { LedgerJSON, StockItemJSON, VoucherJSON } from '@opstally/tally-client';
import type { AgentDb } from './db.js';
import { makeEnvelope, type EventEnvelope, type TallyEventName } from './events.js';

function hashOf(obj: unknown): string {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

export interface DifferContext {
  db: AgentDb;
  company: string;
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
  const tx = ctx.db.db.transaction(() => {
    for (const rec of records) {
      const key = keyOf(rec);
      if (!key) continue;
      const hash = hashOf(hashPayload(rec));
      const prev = ctx.db.getSnapshot(entity, key);
      if (!prev) {
        ctx.db.putSnapshot(entity, key, hash, JSON.stringify(rec));
        if (!ctx.baseline && createdEvent) {
          events.push(makeEnvelope(createdEvent, rec, ctx.company, ctx.installId));
        } else if (!ctx.baseline && !createdEvent) {
          events.push(makeEnvelope(updatedEvent, rec, ctx.company, ctx.installId));
        }
      } else if (prev.hash !== hash) {
        ctx.db.putSnapshot(entity, key, hash, JSON.stringify(rec));
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
 */
export function diffVouchers(ctx: DifferContext, vouchers: VoucherJSON[]): EventEnvelope[] {
  const entity = 'vouchers';
  const wasReset = guardWatermarkRegression(ctx, entity, Math.max(0, ...vouchers.map((v) => v.alterId)));
  if (wasReset) ctx = { ...ctx, baseline: true };

  const events: EventEnvelope[] = [];
  const tx = ctx.db.db.transaction(() => {
    for (const v of vouchers) {
      const key = v.guid || v.masterId;
      if (!key) continue;
      const hash = hashOf(v);
      const prev = ctx.db.getSnapshot(entity, key);
      const wasCancelled = prev ? (JSON.parse(prev.payload_json) as VoucherJSON).isCancelled : false;
      if (!prev) {
        ctx.db.putSnapshot(entity, key, hash, JSON.stringify(v));
        if (!ctx.baseline) {
          events.push(
            makeEnvelope(v.isCancelled ? 'voucher.cancelled' : 'voucher.created', v, ctx.company, ctx.installId)
          );
        }
      } else if (prev.hash !== hash) {
        ctx.db.putSnapshot(entity, key, hash, JSON.stringify(v));
        if (!ctx.baseline) {
          const name: TallyEventName =
            v.isCancelled && !wasCancelled ? 'voucher.cancelled' : 'voucher.updated';
          events.push(makeEnvelope(name, v, ctx.company, ctx.installId));
        }
      }
    }
  });
  tx();

  const maxAlter = Math.max(0, ...vouchers.map((v) => v.alterId));
  if (maxAlter > ctx.db.getWatermark(entity)) ctx.db.setWatermark(entity, maxAlter);
  return events;
}

/**
 * Stock: hash-diff on the fields consumers care about — ClosingBalance is a
 * computed value, so the item's ALTERID does not move when a voucher changes it.
 */
export function diffStock(ctx: DifferContext, items: StockItemJSON[]): EventEnvelope[] {
  const wasReset = guardWatermarkRegression(ctx, 'stock', Math.max(0, ...items.map((i) => i.alterId)));
  if (wasReset) ctx = { ...ctx, baseline: true };
  const events = diffRecords(
    ctx,
    'stock',
    items,
    (i) => i.guid || i.masterId || i.name,
    (i) => ({ qty: i.closingQty, unit: i.baseUnits, sale: i.salePrice, cost: i.costPrice, name: i.name, parent: i.parent }),
    null, // new stock items also arrive as stock.updated — consumers upsert
    'stock.updated'
  );
  const maxAlter = Math.max(0, ...items.map((i) => i.alterId));
  if (maxAlter > ctx.db.getWatermark('stock')) ctx.db.setWatermark('stock', maxAlter);
  return events;
}

export function diffLedgers(ctx: DifferContext, ledgers: LedgerJSON[]): EventEnvelope[] {
  const wasReset = guardWatermarkRegression(ctx, 'ledgers', Math.max(0, ...ledgers.map((l) => l.alterId)));
  if (wasReset) ctx = { ...ctx, baseline: true };
  const events = diffRecords(
    ctx,
    'ledgers',
    ledgers,
    (l) => l.guid || l.masterId || l.name,
    (l) => ({ name: l.name, parent: l.parent, gstin: l.gstin }),
    'ledger.created',
    'ledger.updated'
  );
  const maxAlter = Math.max(0, ...ledgers.map((l) => l.alterId));
  if (maxAlter > ctx.db.getWatermark('ledgers')) ctx.db.setWatermark('ledgers', maxAlter);
  return events;
}

/**
 * If the live max AlterID has moved BELOW our stored watermark, the company
 * was restored from a backup or rewritten — our state is stale. Reset the
 * entity (and vouchers, which share the company's AlterID space) to re-baseline.
 * Returns true when a reset happened so the caller re-baselines silently.
 */
function guardWatermarkRegression(ctx: DifferContext, entity: string, liveMax: number): boolean {
  const stored = ctx.db.getWatermark(entity);
  if (stored > 0 && liveMax > 0 && liveMax < stored) {
    ctx.db.clearEntity(entity);
    ctx.db.clearEntity('vouchers');
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
  chunkSize = 500
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
