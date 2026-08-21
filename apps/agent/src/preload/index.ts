import { contextBridge, ipcRenderer } from 'electron';

const api = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch: Record<string, unknown>) => ipcRenderer.invoke('config:set', patch),
  listCompanies: () => ipcRenderer.invoke('companies:list'),
  testTally: () => ipcRenderer.invoke('tally:test'),
  testWebhook: () => ipcRenderer.invoke('webhook:test'),
  revealSecret: () => ipcRenderer.invoke('secret:reveal'),
  regenerateSecret: () => ipcRenderer.invoke('secret:regenerate'),
  listDeliveries: () => ipcRenderer.invoke('deliveries:list'),
  retryEvent: (id: string) => ipcRenderer.invoke('events:retry', id),
  queueStats: () => ipcRenderer.invoke('queue:stats'),
  runPollNow: () => ipcRenderer.invoke('poll:runNow'),
  fullResync: () => ipcRenderer.invoke('poll:fullResync'),
  fullVoucherResync: () => ipcRenderer.invoke('poll:fullVoucherResync'),
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
