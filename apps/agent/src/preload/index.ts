import { contextBridge, ipcRenderer } from 'electron';

const api = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch: Record<string, unknown>) => ipcRenderer.invoke('config:set', patch),
  addCompany: (name?: string) => ipcRenderer.invoke('company:add', name),
  removeCompany: (companyId: string) => ipcRenderer.invoke('company:remove', companyId),
  setActiveCompany: (companyId: string) => ipcRenderer.invoke('company:setActive', companyId),
  listCompanies: () => ipcRenderer.invoke('companies:list'),
  testTally: () => ipcRenderer.invoke('tally:test'),
  testWebhook: (companyId?: string) => ipcRenderer.invoke('webhook:test', companyId),
  revealSecret: (companyId?: string) => ipcRenderer.invoke('secret:reveal', companyId),
  regenerateSecret: (companyId?: string) => ipcRenderer.invoke('secret:regenerate', companyId),
  listDeliveries: (companyId?: string) => ipcRenderer.invoke('deliveries:list', companyId),
  retryEvent: (id: string) => ipcRenderer.invoke('events:retry', id),
  cancelAllEvents: (companyId?: string) => ipcRenderer.invoke('events:cancelAll', companyId),
  queueStats: (companyId?: string) => ipcRenderer.invoke('queue:stats', companyId),
  runPollNow: (companyId?: string) => ipcRenderer.invoke('poll:runNow', companyId),
  fullResync: (companyId?: string) => ipcRenderer.invoke('poll:fullResync', companyId),
  fullVoucherResync: (companyId?: string) => ipcRenderer.invoke('poll:fullVoucherResync', companyId),
  fullLedgerResync: (companyId?: string) => ipcRenderer.invoke('poll:fullLedgerResync', companyId),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),
  onStatus: (cb: (status: unknown) => void) => {
    const listener = (_e: unknown, status: unknown) => cb(status);
    ipcRenderer.on('status', listener);
    return () => ipcRenderer.removeListener('status', listener);
  },
};

contextBridge.exposeInMainWorld('opstally', api);

export type OpsTallyApi = typeof api;
