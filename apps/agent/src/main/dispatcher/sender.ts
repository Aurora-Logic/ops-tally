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
  private queuePausedUntil = 0;

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

  /** Wake immediately (poller found new events, or settings updated). */
  wake(): void {
    this.queuePausedUntil = 0;
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    if (Date.now() < this.queuePausedUntil) return;

    this.draining = true;
    try {
      const { webhookUrl, secret } = this.deps.getSettings();
      if (!webhookUrl || !secret) {
        this.deps.onStatus?.({ state: 'no_webhook' });
        return;
      }
      // FIFO: keep taking the oldest due event until none are due.
      for (;;) {
        if (Date.now() < this.queuePausedUntil) break;
        const row = this.deps.db.nextDueEvent();
        if (!row) break;
        const ok = await this.deliver(row, webhookUrl, secret);
        // Delivery failure re-schedules the event into the future and pauses the queue.
        if (!ok) break;
      }
      if (Date.now() >= this.queuePausedUntil) {
        this.deps.onStatus?.({ state: 'idle' });
      }
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
        this.queuePausedUntil = 0;
        this.deps.onStatus?.({ state: 'idle', lastDeliveryAt: new Date().toISOString() });
        return true;
      }

      // Handle specific HTTP failure statuses
      if (res.status === 429) {
        // Rate limited: check Retry-After header or response body
        let retryDelayS = 60;
        const retryAfterHeader = res.headers.get('retry-after');
        if (retryAfterHeader && !Number.isNaN(Number(retryAfterHeader))) {
          retryDelayS = Math.max(5, parseInt(retryAfterHeader, 10));
        } else {
          try {
            const errJson = (await res.clone().json()) as any;
            if (errJson?.error?.details?.retryAfterSeconds) {
              retryDelayS = Number(errJson.error.details.retryAfterSeconds);
            }
          } catch {}
        }
        const errorMsg = `Rate limited (HTTP 429). Pausing queue for ${retryDelayS}s...`;
        this.queuePausedUntil = Date.now() + retryDelayS * 1000;
        this.scheduleRetry(row, errorMsg, retryDelayS);
        return false;
      }

      if (res.status === 401) {
        // Authentication failed: bad secret or URL
        const errorMsg = 'Webhook authentication failed (HTTP 401). Check secret in settings.';
        const pauseS = 60;
        this.queuePausedUntil = Date.now() + pauseS * 1000;
        this.scheduleRetry(row, errorMsg, pauseS);
        return false;
      }

      const pauseS = this.scheduleRetry(row, `HTTP ${res.status}`);
      this.queuePausedUntil = Date.now() + pauseS * 1000;
      return false;
    } catch (err: any) {
      this.deps.db.recordDelivery(row.id, null, Date.now() - started, err.message);
      const pauseS = this.scheduleRetry(row, err.message ?? 'network error');
      this.queuePausedUntil = Date.now() + pauseS * 1000;
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

  private scheduleRetry(row: EventRow, error: string, overrideDelayS?: number): number {
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      // Poison event: park it as failed so it stops blocking the FIFO queue.
      this.deps.db.markFailed(row.id, error);
      this.deps.onStatus?.({ state: 'retrying', message: `event ${row.id} failed permanently: ${error}` });
      return 0;
    }
    const delayS = overrideDelayS ?? BACKOFF_S[Math.min(attempts - 1, BACKOFF_S.length - 1)];
    this.deps.db.markRetry(row.id, new Date(Date.now() + delayS * 1000), error);
    this.deps.onStatus?.({ state: 'retrying', message: error });
    return delayS;
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
      if (res.ok) {
        this.wake();
      }
      return { ok: res.ok, status: res.status };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }
}
