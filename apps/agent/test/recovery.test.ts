import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentDb } from '../src/main/engine/db.js';

describe('AgentDb corruption recovery', () => {
  it('moves a corrupt database aside and starts clean instead of crashing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opstally-db-'));
    const dbPath = join(dir, 'agent.db');
    // Not a SQLite file at all — simulates power-cut corruption.
    writeFileSync(dbPath, 'this is definitely not a sqlite database — corrupted by power cut');

    let recoveredReason = '';
    const db = new AgentDb(dbPath, (reason) => (recoveredReason = reason));

    // Fresh DB is fully functional and the corrupt original is preserved.
    expect(recoveredReason).not.toBe('');
    expect(existsSync(`${dbPath}.bak`)).toBe(true);
    db.setMeta('company', 'TestCo');
    expect(db.getMeta('company')).toBe('TestCo');
    expect(db.queueStats()).toEqual({ pending: 0, delivered: 0, failed: 0 });
    db.close();
  });

  it('opens a healthy database without touching it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opstally-db-'));
    const dbPath = join(dir, 'agent.db');

    const first = new AgentDb(dbPath);
    first.setMeta('company', 'KeepMe');
    first.close();

    let recovered = false;
    const second = new AgentDb(dbPath, () => (recovered = true));
    expect(recovered).toBe(false);
    expect(second.getMeta('company')).toBe('KeepMe');
    expect(existsSync(`${dbPath}.bak`)).toBe(false);
    second.close();
  });
});
