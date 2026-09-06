import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EventEnvelope } from './events.js';

export interface EventRow {
  id: string;
  company_id: string;
  event: string;
  payload_json: string;
  created_at: string;
  status: 'pending' | 'delivered' | 'failed' | 'cancelled';
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  delivered_at: string | null;
}

export interface DeliveryRow {
  id: number;
  event_id: string;
  attempted_at: string;
  status_code: number | null;
  duration_ms: number | null;
  error: string | null;
}

export class AgentDb {
  readonly db: Database.Database;

  constructor(dbPath: string, onRecovery?: (reason: string) => void) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = AgentDb.openWithRecovery(dbPath, onRecovery);
    this.migrate();
  }

  /**
   * Hard power cuts on customer PCs can corrupt the database or leave stale
   * WAL locks. A corrupt DB must not crash-loop the agent on every boot: move
   * the damaged files aside (agent.db.bak) and start clean. Cost of recovery:
   * watermarks/snapshots are lost, so the next poll silently re-baselines
   * (safe by design), and any undelivered spooled events are dropped.
   *
   * Only errors raised by SQLite itself (via better-sqlite3's own SqliteError)
   * are treated as corruption. A `new Database()` call that throws before
   * that — native binding failed to load (wrong ABI), file locked, bad
   * permissions — is an environment problem, not a data problem: deleting
   * the file would not fix it and would destroy good data for nothing, so
   * that case propagates immediately instead of triggering recovery.
   */
  private static openWithRecovery(
    dbPath: string,
    onRecovery?: (reason: string) => void
  ): Database.Database {
    const open = (): Database.Database => {
      const db = new Database(dbPath);
      try {
        db.pragma('journal_mode = WAL');
        const check = db.pragma('quick_check', { simple: true });
        if (check !== 'ok') throw new (Database as any).SqliteError(`integrity check failed: ${check}`, 'SQLITE_CORRUPT');
        return db;
      } catch (err) {
        // Close before rethrowing — Windows cannot rename a file with an open handle.
        db.close();
        throw err;
      }
    };

    try {
      return open();
    } catch (err: any) {
      const isCorruption = err instanceof (Database as any).SqliteError;
      if (dbPath === ':memory:' || !isCorruption) throw err;
      onRecovery?.(err.message ?? String(err));
      for (const suffix of ['', '-wal', '-shm']) {
        const file = dbPath + suffix;
        if (!existsSync(file)) continue;
        // Keep the most recent corrupt copy for post-mortem; replace older backups.
        rmSync(`${file}.bak`, { force: true });
        try {
          renameSync(file, `${file}.bak`);
        } catch {
          rmSync(file, { force: true });
        }
      }
      return open();
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS watermarks (
        company_id TEXT NOT NULL DEFAULT 'default',
        entity TEXT NOT NULL,
        last_alter_id INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (company_id, entity)
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        company_id TEXT NOT NULL DEFAULT 'default',
        entity TEXT NOT NULL,
        key TEXT NOT NULL,
        hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (company_id, entity, key)
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT 'default',
        event TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error TEXT,
        delivered_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_queue ON events (company_id, status, next_attempt_at, created_at);
      CREATE TABLE IF NOT EXISTS deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        attempted_at TEXT NOT NULL,
        status_code INTEGER,
        duration_ms INTEGER,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS voucher_types (
        company_id TEXT NOT NULL DEFAULT 'default',
        name TEXT NOT NULL,
        parent TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (company_id, name)
      );
    `);

    // Migration for legacy schema without company_id column
    try {
      const info = this.db.pragma('table_info(watermarks)') as { name: string }[];
      if (info && !info.some((col) => col.name === 'company_id')) {
        this.db.exec(`
          ALTER TABLE watermarks RENAME TO _watermarks_old;
          CREATE TABLE watermarks (
            company_id TEXT NOT NULL DEFAULT 'default',
            entity TEXT NOT NULL,
            last_alter_id INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (company_id, entity)
          );
          INSERT INTO watermarks (company_id, entity, last_alter_id, updated_at)
            SELECT 'default', entity, last_alter_id, updated_at FROM _watermarks_old;
          DROP TABLE _watermarks_old;

          ALTER TABLE snapshots RENAME TO _snapshots_old;
          CREATE TABLE snapshots (
            company_id TEXT NOT NULL DEFAULT 'default',
            entity TEXT NOT NULL,
            key TEXT NOT NULL,
            hash TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (company_id, entity, key)
          );
          INSERT INTO snapshots (company_id, entity, key, hash, payload_json)
            SELECT 'default', entity, key, hash, payload_json FROM _snapshots_old;
          DROP TABLE _snapshots_old;
        `);
      }
    } catch {}

    try {
      const info = this.db.pragma('table_info(events)') as { name: string }[];
      if (info && !info.some((col) => col.name === 'company_id')) {
        this.db.exec(`ALTER TABLE events ADD COLUMN company_id TEXT NOT NULL DEFAULT 'default';`);
      }
    } catch {}
  }

  // ---- meta ----
  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  /** Stable per-install identifier, minted on first run. */
  installId(): string {
    let id = this.getMeta('install_id');
    if (!id) {
      id = randomUUID();
      this.setMeta('install_id', id);
    }
    return id;
  }

  // ---- watermarks ----
  getWatermark(companyIdOrEntity: string, maybeEntity?: string): number {
    const companyId = maybeEntity !== undefined ? companyIdOrEntity : 'default';
    const entity = maybeEntity !== undefined ? maybeEntity : companyIdOrEntity;
    const row = this.db
      .prepare('SELECT last_alter_id FROM watermarks WHERE company_id = ? AND entity = ?')
      .get(companyId, entity) as { last_alter_id: number } | undefined;
    return row?.last_alter_id ?? 0;
  }

  setWatermark(companyIdOrEntity: string, entityOrAlterId: string | number, maybeAlterId?: number): void {
    const companyId = maybeAlterId !== undefined ? companyIdOrEntity : 'default';
    const entity = maybeAlterId !== undefined ? (entityOrAlterId as string) : companyIdOrEntity;
    const alterId = maybeAlterId !== undefined ? maybeAlterId : (entityOrAlterId as number);
    this.db
      .prepare(
        `INSERT INTO watermarks (company_id, entity, last_alter_id, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(company_id, entity) DO UPDATE SET last_alter_id = excluded.last_alter_id, updated_at = excluded.updated_at`
      )
      .run(companyId, entity, alterId, new Date().toISOString());
  }

  // ---- snapshots ----
  getSnapshot(companyIdOrEntity: string, entityOrKey: string, maybeKey?: string): { hash: string; payload_json: string } | undefined {
    const companyId = maybeKey !== undefined ? companyIdOrEntity : 'default';
    const entity = maybeKey !== undefined ? entityOrKey : companyIdOrEntity;
    const key = maybeKey !== undefined ? maybeKey : entityOrKey;
    return this.db
      .prepare('SELECT hash, payload_json FROM snapshots WHERE company_id = ? AND entity = ? AND key = ?')
      .get(companyId, entity, key) as { hash: string; payload_json: string } | undefined;
  }

  putSnapshot(companyIdOrEntity: string, entityOrKey: string, keyOrHash: string, hashOrPayload: string, maybePayload?: string): void {
    const companyId = maybePayload !== undefined ? companyIdOrEntity : 'default';
    const entity = maybePayload !== undefined ? entityOrKey : companyIdOrEntity;
    const key = maybePayload !== undefined ? keyOrHash : entityOrKey;
    const hash = maybePayload !== undefined ? hashOrPayload : keyOrHash;
    const payloadJson = maybePayload !== undefined ? maybePayload : hashOrPayload;
    this.db
      .prepare(
        `INSERT INTO snapshots (company_id, entity, key, hash, payload_json) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(company_id, entity, key) DO UPDATE SET hash = excluded.hash, payload_json = excluded.payload_json`
      )
      .run(companyId, entity, key, hash, payloadJson);
  }

  clearEntity(companyIdOrEntity: string, maybeEntity?: string): void {
    const companyId = maybeEntity !== undefined ? companyIdOrEntity : 'default';
    const entity = maybeEntity !== undefined ? maybeEntity : companyIdOrEntity;
    this.db.prepare('DELETE FROM snapshots WHERE company_id = ? AND entity = ?').run(companyId, entity);
    this.db.prepare('DELETE FROM watermarks WHERE company_id = ? AND entity = ?').run(companyId, entity);
    this.db.prepare("DELETE FROM meta WHERE key = ?").run(`baseline:${companyId}:${entity}`);
    this.db.prepare("DELETE FROM meta WHERE key = ?").run(`baseline:${entity}`);
  }

  /** Wipe sync state (snapshots, watermarks, baselines) for a specific company or all companies. */
  resetSyncState(companyId?: string): void {
    if (companyId) {
      this.db.prepare('DELETE FROM snapshots WHERE company_id = ?').run(companyId);
      this.db.prepare('DELETE FROM watermarks WHERE company_id = ?').run(companyId);
      this.db.prepare("DELETE FROM meta WHERE key LIKE ?").run(`baseline:${companyId}:%`);
    } else {
      this.db.exec("DELETE FROM snapshots; DELETE FROM watermarks; DELETE FROM meta WHERE key LIKE 'baseline:%';");
    }
  }

  // ---- events queue ----
  enqueueEvent(companyIdOrEnvelope: string | EventEnvelope, maybeEnvelope?: EventEnvelope): void {
    const companyId = maybeEnvelope !== undefined ? (companyIdOrEnvelope as string) : 'default';
    const envelope = (maybeEnvelope !== undefined ? maybeEnvelope : companyIdOrEnvelope) as EventEnvelope;
    this.db
      .prepare(
        `INSERT INTO events (id, company_id, event, payload_json, created_at, status, next_attempt_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`
      )
      .run(envelope.id, companyId, envelope.event, JSON.stringify(envelope), envelope.created_at, envelope.created_at);
  }

  /** Oldest pending event that is due, FIFO. */
  nextDueEvent(now = new Date(), companyId?: string): EventRow | undefined {
    if (companyId) {
      return this.db
        .prepare(
          `SELECT * FROM events WHERE company_id = ? AND status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
           ORDER BY created_at ASC LIMIT 1`
        )
        .get(companyId, now.toISOString()) as EventRow | undefined;
    }
    return this.db
      .prepare(
        `SELECT * FROM events WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY created_at ASC LIMIT 1`
      )
      .get(now.toISOString()) as EventRow | undefined;
  }

  markDelivered(id: string): void {
    this.db
      .prepare("UPDATE events SET status = 'delivered', delivered_at = ?, last_error = NULL WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  markRetry(id: string, nextAttemptAt: Date, error: string): void {
    this.db
      .prepare("UPDATE events SET attempts = attempts + 1, next_attempt_at = ?, last_error = ? WHERE id = ?")
      .run(nextAttemptAt.toISOString(), error.slice(0, 500), id);
  }

  markFailed(id: string, error: string): void {
    this.db
      .prepare("UPDATE events SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?")
      .run(error.slice(0, 500), id);
  }

  retryEvent(id: string): void {
    this.db
      .prepare("UPDATE events SET status = 'pending', attempts = 0, next_attempt_at = ?, last_error = NULL WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  cancelPendingEvents(companyId?: string): number {
    if (companyId) {
      const res = this.db
        .prepare("UPDATE events SET status = 'cancelled', last_error = 'Cancelled by user' WHERE company_id = ? AND status = 'pending'")
        .run(companyId);
      return Number(res.changes);
    }
    const res = this.db
      .prepare("UPDATE events SET status = 'cancelled', last_error = 'Cancelled by user' WHERE status = 'pending'")
      .run();
    return Number(res.changes);
  }

  recordDelivery(eventId: string, statusCode: number | null, durationMs: number, error?: string): void {
    this.db
      .prepare('INSERT INTO deliveries (event_id, attempted_at, status_code, duration_ms, error) VALUES (?, ?, ?, ?, ?)')
      .run(eventId, new Date().toISOString(), statusCode, durationMs, error ? error.slice(0, 500) : null);
  }

  recentEvents(limit = 50, companyId?: string): EventRow[] {
    if (companyId) {
      return this.db
        .prepare('SELECT * FROM events WHERE company_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(companyId, limit) as EventRow[];
    }
    return this.db
      .prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT ?')
      .all(limit) as EventRow[];
  }

  queueStats(companyId?: string): { pending: number; delivered: number; failed: number } {
    const rows = companyId
      ? (this.db
          .prepare('SELECT status, COUNT(*) AS n FROM events WHERE company_id = ? GROUP BY status')
          .all(companyId) as { status: string; n: number }[])
      : (this.db
          .prepare('SELECT status, COUNT(*) AS n FROM events GROUP BY status')
          .all() as { status: string; n: number }[]);

    const stats = { pending: 0, delivered: 0, failed: 0 };
    for (const r of rows) {
      if (r.status in stats) (stats as any)[r.status] = r.n;
    }
    return stats;
  }

  // ---- voucher types cache ----
  getVoucherTypes(companyId = 'default'): { name: string; parent?: string }[] {
    const rows = this.db
      .prepare('SELECT name, parent FROM voucher_types WHERE company_id = ? ORDER BY name ASC')
      .all(companyId) as { name: string; parent: string | null }[];
    return rows.map((r) => ({ name: r.name, parent: r.parent ?? undefined }));
  }

  saveVoucherTypes(companyId = 'default', types: { name: string; parent?: string }[]): void {
    const now = new Date().toISOString();
    const insert = this.db.prepare(
      `INSERT INTO voucher_types (company_id, name, parent, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(company_id, name) DO UPDATE SET parent = excluded.parent, updated_at = excluded.updated_at`
    );
    const tx = this.db.transaction(() => {
      if (types.length > 0) {
        const placeholders = types.map(() => '?').join(',');
        this.db
          .prepare(`DELETE FROM voucher_types WHERE company_id = ? AND name NOT IN (${placeholders})`)
          .run(companyId, ...types.map((t) => t.name));
      } else {
        this.db.prepare('DELETE FROM voucher_types WHERE company_id = ?').run(companyId);
      }
      for (const t of types) {
        insert.run(companyId, t.name, t.parent ?? null, now);
      }
      this.setMeta(`voucher_types_verified_at:${companyId}`, now);
    });
    tx();
  }

  getVoucherTypesLastVerifiedAt(companyId = 'default'): string | null {
    return this.getMeta(`voucher_types_verified_at:${companyId}`) ?? null;
  }

  close(): void {
    this.db.close();
  }
}
