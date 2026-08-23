import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import type { StockItemJSON, VoucherJSON } from '@opstally/tally-client';
import { AgentDb } from '../src/main/engine/db.js';
import { diffStock, diffVouchers, type DifferContext } from '../src/main/engine/differ.js';
import { makeEnvelope } from '../src/main/engine/events.js';
import { Dispatcher } from '../src/main/dispatcher/sender.js';
import { generateSecret, signBody } from '../src/main/dispatcher/signer.js';
import { makeVoucher } from './support/voucher.js';

const voucher = (over: Partial<VoucherJSON> = {}): VoucherJSON => makeVoucher(over);

const stockItem = (over: Partial<StockItemJSON> = {}): StockItemJSON => ({
  masterId: '101',
  alterId: 10,
  guid: 'g-101',
  name: 'Plywood',
  parent: 'Wood',
  baseUnits: 'NOS',
  closingQty: 5,
  closingRate: 100,
  closingValue: 500,
  salePrice: 120,
  costPrice: 100,
  ...over,
});

function ctx(db: AgentDb, baseline = false): DifferContext {
  return { db, company: 'TestCo', installId: 'install-1', baseline };
}

describe('diffVouchers', () => {
  it('baseline snapshots emit nothing; later polls classify created/updated/cancelled', () => {
    const db = new AgentDb(':memory:');
    expect(diffVouchers(ctx(db, true), [voucher()])).toHaveLength(0);
    expect(db.getWatermark('vouchers')).toBe(100);

    // New voucher → created
    const created = diffVouchers(ctx(db), [voucher({ guid: 'g-502', masterId: '502', alterId: 101 })]);
    expect(created).toHaveLength(1);
    expect(created[0].event).toBe('voucher.created');

    // Same voucher changed → updated
    const updated = diffVouchers(ctx(db), [voucher({ guid: 'g-502', masterId: '502', alterId: 102, amount: -200 })]);
    expect(updated.map((e) => e.event)).toEqual(['voucher.updated']);

    // Cancellation transition → cancelled
    const cancelled = diffVouchers(ctx(db), [
      voucher({ guid: 'g-502', masterId: '502', alterId: 103, amount: -200, isCancelled: true }),
    ]);
    expect(cancelled.map((e) => e.event)).toEqual(['voucher.cancelled']);

    // Unchanged → silence
    expect(
      diffVouchers(ctx(db), [voucher({ guid: 'g-502', masterId: '502', alterId: 103, amount: -200, isCancelled: true })])
    ).toHaveLength(0);
    expect(db.getWatermark('vouchers')).toBe(103);
  });
});

describe('diffStock', () => {
  it('hash-diffs quantity and price changes only', () => {
    const db = new AgentDb(':memory:');
    expect(diffStock(ctx(db, true), [stockItem()])).toHaveLength(0);

    // closingValue changes alone do not trigger (not in the hash payload)
    expect(diffStock(ctx(db), [stockItem({ closingValue: 999 })])).toHaveLength(0);

    const events = diffStock(ctx(db), [stockItem({ closingQty: 3 })]);
    expect(events.map((e) => e.event)).toEqual(['stock.updated']);
    expect((events[0].payload as StockItemJSON).closingQty).toBe(3);
  });

  it('re-baselines when the live AlterID regresses below the watermark', () => {
    const db = new AgentDb(':memory:');
    diffStock(ctx(db, true), [stockItem({ alterId: 50 })]);
    expect(db.getWatermark('stock')).toBe(50);

    // Company restored from backup: live max AlterID drops to 10.
    const events = diffStock(ctx(db), [stockItem({ alterId: 10, closingQty: 99 })]);
    // State was cleared, so this poll re-snapshots silently rather than firing.
    expect(events).toHaveLength(0);
    expect(db.getWatermark('stock')).toBe(10);
  });
});

describe('Dispatcher', () => {
  const servers: Server[] = [];
  afterEach(() => {
    servers.forEach((s) => s.close());
    servers.length = 0;
  });

  function sink(
    handler: (headers: Record<string, string | string[] | undefined>, body: string) => number
  ): Promise<string> {
    return new Promise((resolve) => {
      const srv = createServer((req, res) => {
        let data = '';
        req.on('data', (c) => (data += c));
        req.on('end', () => {
          res.writeHead(handler(req.headers as any, data));
          res.end();
        });
      });
      servers.push(srv);
      srv.listen(0, '127.0.0.1', () =>
        resolve(`http://127.0.0.1:${(srv.address() as { port: number }).port}`)
      );
    });
  }

  it('delivers a correctly signed event and marks it delivered', async () => {
    const db = new AgentDb(':memory:');
    const secret = generateSecret();
    let receivedSig = '';
    let receivedBody = '';
    const url = await sink((headers, body) => {
      receivedSig = String(headers['x-tally-signature']);
      receivedBody = body;
      return 200;
    });

    const envelope = makeEnvelope('stock.updated', { name: 'Plywood' }, 'TestCo', 'install-1');
    db.enqueueEvent(envelope);

    const d = new Dispatcher({ db, getSettings: () => ({ webhookUrl: url, secret }) });
    await (d as any).drain();

    const expected = createHmac('sha256', secret).update(receivedBody, 'utf8').digest('hex');
    expect(receivedSig).toBe(expected);
    expect(JSON.parse(receivedBody).event).toBe('stock.updated');
    expect(db.queueStats()).toEqual({ pending: 0, delivered: 1, failed: 0 });
  });

  it('schedules a retry with backoff on non-2xx and preserves the event', async () => {
    const db = new AgentDb(':memory:');
    const url = await sink(() => 500);
    db.enqueueEvent(makeEnvelope('ping', {}, 'TestCo', 'install-1'));

    const d = new Dispatcher({ db, getSettings: () => ({ webhookUrl: url, secret: 's' }) });
    await (d as any).drain();

    const row = db.recentEvents(1)[0];
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBe('HTTP 500');
    expect(new Date(row.next_attempt_at!).getTime()).toBeGreaterThan(Date.now() + 20_000);
    // Not due yet, so a second drain must not attempt it again.
    expect(db.nextDueEvent()).toBeUndefined();
  });

  it('signBody matches an independent HMAC implementation', () => {
    expect(signBody('{"a":1}', 'topsecret')).toBe(
      createHmac('sha256', 'topsecret').update('{"a":1}', 'utf8').digest('hex')
    );
  });
});
