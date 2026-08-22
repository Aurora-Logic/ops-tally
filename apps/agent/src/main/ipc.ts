import { ipcMain } from 'electron';
import { TallyClient, TallyError } from '@opstally/tally-client';
import type { AgentDb } from './engine/db.js';
import type { Poller } from './engine/poller.js';
import type { Dispatcher } from './dispatcher/sender.js';
import {
  getConfig,
  getPublicConfig,
  getSecret,
  regenerateSecret,
  updateConfig,
  type PublicConfig,
} from './config.js';
import { getSettings, setSettings, type GlobalSettings } from './settings/settings.js';
import { productNamesFrom } from './engine/events.js';

export interface IpcDeps {
  db: AgentDb;
  client: TallyClient;
  poller: Poller;
  dispatcher: Dispatcher;
  broadcastStatus: () => void;
}

function tallyClientFromConfig(): TallyClient {
  const cfg = getConfig();
  return new TallyClient({ host: cfg.tallyHost, port: cfg.tallyPort, company: cfg.company });
}

export function registerIpc(deps: IpcDeps): void {
  const { db, poller, dispatcher, broadcastStatus } = deps;

  ipcMain.handle('config:get', () => getPublicConfig());

  ipcMain.handle('config:set', (_e, patch: Partial<PublicConfig>) => {
    const cfg = updateConfig(patch);
    broadcastStatus();
    return cfg;
  });

  ipcMain.handle('companies:list', async () => {
    try {
      return { ok: true, companies: await tallyClientFromConfig().listCompanies() };
    } catch (err: any) {
      return { ok: false, error: err instanceof TallyError ? err.message : String(err?.message ?? err) };
    }
  });

  ipcMain.handle('tally:test', async () => {
    try {
      const companies = await tallyClientFromConfig().listCompanies();
      return { ok: true, message: `Connected — ${companies.length} company(ies) loaded` };
    } catch (err: any) {
      return { ok: false, error: err instanceof TallyError ? err.message : String(err?.message ?? err) };
    }
  });

  ipcMain.handle('webhook:test', async () => {
    const cfg = getConfig();
    return dispatcher.sendTest(cfg.company, db.installId());
  });

  ipcMain.handle('secret:reveal', () => getSecret());

  ipcMain.handle('secret:regenerate', () => regenerateSecret());

  ipcMain.handle('deliveries:list', () =>
    db.recentEvents(100).map((row) => {
      let products: string[] | undefined;
      try {
        const envelope = JSON.parse(row.payload_json) as { payload?: unknown };
        products = productNamesFrom(row.event, envelope.payload);
      } catch {
        products = undefined;
      }
      return {
        id: row.id,
        event: row.event,
        created_at: row.created_at,
        status: row.status,
        attempts: row.attempts,
        next_attempt_at: row.next_attempt_at,
        last_error: row.last_error,
        delivered_at: row.delivered_at,
        products,
      };
    })
  );

  ipcMain.handle('events:retry', (_e, id: string) => {
    db.retryEvent(id);
    dispatcher.wake();
    return true;
  });

  ipcMain.handle('queue:stats', () => db.queueStats());

  ipcMain.handle('poll:runNow', () => {
    void poller.pollAll();
    return true;
  });

  ipcMain.handle('poll:fullResync', () => {
    void poller.fullStockResync();
    return true;
  });

  ipcMain.handle('poll:fullVoucherResync', () => {
    void poller.fullVoucherResync();
    return true;
  });

  ipcMain.handle('settings:get', () => getSettings());

  ipcMain.handle('settings:set', (_e, patch: Partial<GlobalSettings>) => setSettings(patch));
}
