import { ipcMain } from 'electron';
import { TallyClient, TallyError } from '@opstally/tally-client';
import type { AgentDb } from './engine/db.js';
import type { Poller } from './engine/poller.js';
import type { Dispatcher } from './dispatcher/sender.js';
import {
  addCompany,
  getConfig,
  getCompanySecret,
  getPublicConfig,
  regenerateCompanySecret,
  removeCompany,
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
  const active = cfg.companies.find((c) => c.id === cfg.activeCompanyId);
  return new TallyClient({ host: cfg.tallyHost, port: cfg.tallyPort, company: active?.name ?? '' });
}

export function registerIpc(deps: IpcDeps): void {
  const { db, poller, dispatcher, broadcastStatus } = deps;

  ipcMain.handle('config:get', () => getPublicConfig());

  ipcMain.handle('config:set', (_e, patch: Partial<PublicConfig>) => {
    const cfg = updateConfig(patch);
    dispatcher.wake();
    broadcastStatus();
    return cfg;
  });

  ipcMain.handle('company:add', (_e, name = '') => {
    const pub = addCompany(name);
    dispatcher.wake();
    broadcastStatus();
    return pub;
  });

  ipcMain.handle('company:remove', (_e, companyId: string) => {
    const ok = removeCompany(companyId);
    dispatcher.wake();
    broadcastStatus();
    return ok;
  });

  ipcMain.handle('company:setActive', (_e, companyId: string) => {
    const cfg = updateConfig({ activeCompanyId: companyId });
    broadcastStatus();
    return cfg;
  });

  ipcMain.handle('companies:list', async () => {
    try {
      const companies = await tallyClientFromConfig().listCompanies();
      poller.reportLiveness(true);
      broadcastStatus();
      return { ok: true, companies };
    } catch (err: any) {
      const msg = err instanceof TallyError ? err.message : String(err?.message ?? err);
      poller.reportLiveness(false, msg);
      broadcastStatus();
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle('tally:test', async () => {
    try {
      const companies = await tallyClientFromConfig().listCompanies();
      poller.reportLiveness(true);
      broadcastStatus();
      return { ok: true, message: `Connected — ${companies.length} company(ies) loaded in Tally` };
    } catch (err: any) {
      const msg = err instanceof TallyError ? err.message : String(err?.message ?? err);
      poller.reportLiveness(false, msg);
      broadcastStatus();
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle('webhook:test', async (_e, companyId?: string) => {
    const cfg = getConfig();
    const targetId = companyId || cfg.activeCompanyId;
    const comp = cfg.companies.find((c) => c.id === targetId) ?? cfg.companies[0];
    return dispatcher.sendTest(comp?.name ?? '', db.installId(), targetId);
  });

  ipcMain.handle('secret:reveal', (_e, companyId?: string) => getCompanySecret(companyId));

  ipcMain.handle('secret:regenerate', (_e, companyId?: string) => {
    const s = regenerateCompanySecret(companyId);
    dispatcher.wake();
    return s;
  });

  ipcMain.handle('deliveries:list', (_e, companyId?: string) =>
    db.recentEvents(100, companyId).map((row) => {
      let products: string[] | undefined;
      try {
        const envelope = JSON.parse(row.payload_json) as { payload?: unknown };
        products = productNamesFrom(row.event, envelope.payload);
      } catch {
        products = undefined;
      }
      return {
        id: row.id,
        company_id: row.company_id,
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

  ipcMain.handle('events:cancelAll', (_e, companyId?: string) => {
    const count = dispatcher.cancelAll(companyId);
    broadcastStatus();
    return { ok: true, count };
  });

  ipcMain.handle('poll:runNow', async (_e, companyId?: string) => {
    return await poller.pollAll(companyId);
  });

  ipcMain.handle('poll:watermarks', (_e, companyId?: string) => {
    const targetId = companyId || getConfig().activeCompanyId;
    return {
      vouchers: db.getWatermark(targetId, 'vouchers'),
      stock: db.getWatermark(targetId, 'stock'),
      ledgers: db.getWatermark(targetId, 'ledgers'),
    };
  });

  ipcMain.handle('poll:fullResync', (_e, companyId?: string) => {
    void poller.fullStockResync(companyId);
    return true;
  });

  ipcMain.handle('poll:fullVoucherResync', (_e, companyId?: string) => {
    void poller.fullVoucherResync(companyId);
    return true;
  });

  ipcMain.handle('poll:fullLedgerResync', (_e, companyId?: string) => {
    void poller.fullLedgerResync(companyId);
    return true;
  });

  ipcMain.handle('settings:get', () => getSettings());

  ipcMain.handle('settings:set', (_e, patch: Partial<GlobalSettings>) => setSettings(patch));
}
