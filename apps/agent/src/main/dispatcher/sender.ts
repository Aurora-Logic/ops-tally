import { signBody } from './signer.js';
import type { AgentDb, EventRow } from '../engine/db.js';
import { makeEnvelope } from '../engine/events.js';

export interface DispatcherSettings {
  webhookUrl: string;
  secret: string;
}

export type DispatcherState = 'idle' | 'sending' | 'retrying' | 'no_webhook';

export interface DispatcherStatus {
  state: DispatcherState;
  lastDeliveryAt?: string;
  message?: string;
}

export interface DispatcherDeps {
  db: AgentDb;
  getSettings: () => DispatcherSettings;
  onStatus?: (status: DispatcherStatus) => void;
  agentVersion?: string;
}

/** Backoff schedule in seconds; attempts beyond the schedule reuse the last entry. */
const BACKOFF_S = [30, 120, 600, 1800, 7200, 21600];
const MAX_ATTEMPTS = 12;

export class Dispatcher {
  private deps: DispatcherDeps;
  private timer: ReturnType<typeof setInterval> | undefined;
  private draining = false;

  constructor(deps: DispatcherDeps) {
    this.deps = deps;
  }

  start(tickMs = 5000): void {
    this.stop();
    this.timer = setInterval(() => void this.drain(), tickMs);
    void this.drain();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Wake immediately (poller found new events). */
  wake(): void {
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const { webhookUrl, secret } = this.deps.getSettings();
      if (!webhookUrl || !secret) {
        this.deps.onStatus?.({ state: 'no_webhook' });
        return;
      }
      // FIFO: keep taking the oldest due event until none are due.
      for (;;) {
        const row = this.deps.db.nextDueEvent();
        if (!row) break;
        const ok = await this.deliver(row, webhookUrl, secret);
        // Delivery failure re-schedules the event into the future, so the
        // loop naturally stops retrying it this pass and moves on next tick.
        if (!ok) break;
      }
      this.deps.onStatus?.({ state: 'idle' });
    } finally {
      this.draining = false;
    }
  }

  private async deliver(row: EventRow, webhookUrl: string, secret: string): Promise<boolean> {
    this.deps.onStatus?.({ state: 'sending' });
    const body = row.payload_json;
    const started = Date.now();
    try {
      const res = await this.post(webhookUrl, body, row, secret);
      const duration = Date.now() - started;
      this.deps.db.recordDelivery(row.id, res.status, duration);
      if (res.ok) {
        this.deps.db.markDelivered(row.id);
        this.deps.onStatus?.({ state: 'idle', lastDeliveryAt: new Date().toISOString() });
        return true;
      }
      this.scheduleRetry(row, `HTTP ${res.status}`);
      return false;
    } catch (err: any) {
      this.deps.db.recordDelivery(row.id, null, Date.now() - started, err.message);
      this.scheduleRetry(row, err.message ?? 'network error');
      return false;
    }
  }

  private async post(url: string, body: string, row: EventRow, secret: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tally-Signature': signBody(body, secret),
          'X-Tally-Event': row.event,
          'X-Tally-Event-Id': row.id,
          'User-Agent': `opstally-agent/${this.deps.agentVersion ?? 'dev'}`,
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private scheduleRetry(row: EventRow, error: string): void {
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      // Poison event: park it as failed so it stops blocking the FIFO queue.
      this.deps.db.markFailed(row.id, error);
      this.deps.onStatus?.({ state: 'retrying', message: `event ${row.id} failed permanently: ${error}` });
      return;
    }
    const delayS = BACKOFF_S[Math.min(attempts - 1, BACKOFF_S.length - 1)];
    this.deps.db.markRetry(row.id, new Date(Date.now() + delayS * 1000), error);
    this.deps.onStatus?.({ state: 'retrying', message: error });
  }

  /** Fire a signed ping event directly (settings "Send test event" button). */
  async sendTest(company: string, installId: string): Promise<{ ok: boolean; status?: number; error?: string }> {
    const { webhookUrl, secret } = this.deps.getSettings();
    if (!webhookUrl || !secret) return { ok: false, error: 'Webhook URL or secret not configured' };
    const envelope = makeEnvelope('ping', { message: 'OpsTally Agent test event' }, company, installId);
    const body = JSON.stringify(envelope);
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tally-Signature': signBody(body, secret),
          'X-Tally-Event': 'ping',
          'X-Tally-Event-Id': envelope.id,
          'User-Agent': `opstally-agent/${this.deps.agentVersion ?? 'dev'}`,
        },
        body,
      });
      return { ok: res.ok, status: res.status };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }
}
