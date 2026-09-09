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
  getSettings: (companyId?: string) => DispatcherSettings;
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
  private pausedUntilByCompany = new Map<string, number>();

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
  wake(companyId?: string): void {
    if (companyId) {
      this.pausedUntilByCompany.delete(companyId);
    } else {
      this.pausedUntilByCompany.clear();
    }
    void this.drain();
  }

  isRateLimited(companyId?: string): boolean {
    if (companyId) {
      return (this.pausedUntilByCompany.get(companyId) ?? 0) > Date.now();
    }
    return [...this.pausedUntilByCompany.values()].some((t) => Date.now() < t);
  }

  getQueuePausedUntil(companyId?: string): number {
    if (companyId) {
      return this.pausedUntilByCompany.get(companyId) ?? 0;
    }
    return Math.max(0, ...this.pausedUntilByCompany.values());
  }

  private async drain(): Promise<void> {
    if (this.draining) return;

    this.draining = true;
    try {
      // FIFO: keep taking the oldest due event for unpaused companies until none are due.
      for (;;) {
        const now = Date.now();
        const pausedCompanyIds = [...this.pausedUntilByCompany.entries()]
          .filter(([_, t]) => now < t)
          .map(([cid]) => cid);

        const row = this.deps.db.nextDueEvent(new Date(), undefined, pausedCompanyIds);
        if (!row) break;

        const { webhookUrl, secret } = this.deps.getSettings(row.company_id);
        if (!webhookUrl || !secret) {
          // If event belongs to legacy 'default' or an unconfigured company
          if (row.company_id === 'default') {
            this.deps.db.markFailed(row.id, 'Legacy orphan event cancelled');
            continue;
          }

          this.deps.onStatus?.({ state: 'no_webhook', message: 'Webhook not configured or company disabled' });
          // Schedule a backoff for this company's event and pause this company in this cycle
          this.scheduleRetry(row, 'Webhook URL or secret not configured or company disabled', 300);
          this.pausedUntilByCompany.set(row.company_id, Date.now() + 300_000);
          continue;
        }

        const ok = await this.deliver(row, webhookUrl, secret);
        if (!ok) {
          // Delivery failure re-scheduled the event into the future and paused that specific company.
          // Loop continues to check if other companies have events to deliver!
        }
      }

      const anyPaused = [...this.pausedUntilByCompany.values()].some((t) => Date.now() < t);
      if (!anyPaused) {
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
        this.pausedUntilByCompany.delete(row.company_id);
        this.deps.onStatus?.({ state: 'idle', lastDeliveryAt: new Date().toISOString() });
        return true;
      }

      // Extract error detail from response body if present
      let errorDetail = '';
      try {
        const text = await res.text();
        try {
          const json = JSON.parse(text);
          errorDetail = json.message || json.error?.message || json.error || text;
        } catch {
          errorDetail = text;
        }
      } catch {}

      // Handle specific HTTP failure statuses
      if (res.status === 409) {
        const errorMsg = errorDetail
          ? `Conflict (HTTP 409): ${errorDetail}`
          : 'Conflict (HTTP 409): Company name or install ID mismatch between Tally and Vyuha.';
        const pauseS = this.scheduleRetry(row, errorMsg);
        this.pausedUntilByCompany.set(row.company_id, Date.now() + pauseS * 1000);
        this.deps.onStatus?.({ state: 'retrying', message: errorMsg });
        return false;
      }

      if (res.status === 429) {
        // Rate limited: default to 15 minutes (900s) if header/body doesn't specify
        let retryDelayS = 900;
        const retryAfterHeader = res.headers.get('retry-after');
        if (retryAfterHeader && !Number.isNaN(Number(retryAfterHeader))) {
          retryDelayS = Math.max(5, parseInt(retryAfterHeader, 10));
        } else if (errorDetail) {
          try {
            const json = JSON.parse(errorDetail);
            if (json?.details?.retryAfterSeconds || json?.error?.details?.retryAfterSeconds) {
              retryDelayS = Number(json.details?.retryAfterSeconds ?? json.error?.details?.retryAfterSeconds);
            }
          } catch {}
        }
        const resumeTimeStr = new Date(Date.now() + retryDelayS * 1000).toLocaleTimeString();
        const errorMsg = `Rate limited (HTTP 429). Pausing queue for ${Math.round(retryDelayS / 60)}m (until ${resumeTimeStr}). ${errorDetail ? `Server: ${errorDetail}` : ''}`;
        this.pausedUntilByCompany.set(row.company_id, Date.now() + retryDelayS * 1000);
        this.scheduleRetry(row, errorMsg, retryDelayS);
        this.deps.onStatus?.({ state: 'retrying', message: errorMsg });
        return false;
      }

      if (res.status === 401) {
        // Authentication failed: bad secret or URL
        const errorMsg = `Webhook auth failed (HTTP 401): ${errorDetail || 'Check secret in settings.'}`;
        const pauseS = 60;
        this.pausedUntilByCompany.set(row.company_id, Date.now() + pauseS * 1000);
        this.scheduleRetry(row, errorMsg, pauseS);
        this.deps.onStatus?.({ state: 'retrying', message: errorMsg });
        return false;
      }

      const errorMsg = errorDetail ? `HTTP ${res.status}: ${errorDetail}` : `HTTP ${res.status}`;
      const pauseS = this.scheduleRetry(row, errorMsg);
      this.pausedUntilByCompany.set(row.company_id, Date.now() + pauseS * 1000);
      this.deps.onStatus?.({ state: 'retrying', message: errorMsg });
      return false;
    } catch (err: any) {
      const isAbort = err.name === 'AbortError';
      const msg = isAbort
        ? 'Request timed out after 120s (server took too long to respond)'
        : (err.message ?? 'Network error');
      this.deps.db.recordDelivery(row.id, null, Date.now() - started, msg);
      const pauseS = this.scheduleRetry(row, msg);
      this.pausedUntilByCompany.set(row.company_id, Date.now() + pauseS * 1000);
      return false;
    }
  }

  private async post(url: string, body: string, row: EventRow, secret: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
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

  /** Force retry all pending/failed events and unpause queue. */
  retryAll(companyId?: string): number {
    if (companyId) {
      this.pausedUntilByCompany.delete(companyId);
    } else {
      this.pausedUntilByCompany.clear();
    }
    const count = this.deps.db.retryAllPending(companyId);
    this.wake(companyId);
    this.deps.onStatus?.({ state: 'idle', message: `Retrying ${count} event(s)...` });
    return count;
  }

  /** Fire a signed ping event directly (settings "Send test event" button). */
  async sendTest(company: string, installId: string, companyId?: string): Promise<{ ok: boolean; status?: number; error?: string }> {
    const { webhookUrl, secret } = this.deps.getSettings(companyId);
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
        this.wake(companyId);
      }
      return { ok: res.ok, status: res.status };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /** Cancel all pending dispatches in the database and reset queue pause. */
  cancelAll(companyId?: string): number {
    if (companyId) {
      this.pausedUntilByCompany.delete(companyId);
    } else {
      this.pausedUntilByCompany.clear();
    }
    const count = this.deps.db.cancelPendingEvents(companyId);
    this.deps.onStatus?.({ state: 'idle', message: `Cancelled ${count} queued event(s)` });
    return count;
  }
}
