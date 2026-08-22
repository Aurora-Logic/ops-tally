export interface PublicConfig {
  webhookUrl: string;
  tallyHost: string;
  tallyPort: number;
  company: string;
  intervalsMinutes: { vouchers: number; stock: number; ledgers: number };
  voucherLookbackDays: number;
  voucherTypes: string[];
  paused: boolean;
  openAtLogin: boolean;
}

export interface DeliveryRow {
  id: string;
  event: string;
  created_at: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  delivered_at: string | null;
  /** Stock item names carried by this event's payload (stock.updated / stock.snapshot only). */
  products?: string[];
}

export interface GlobalSettings {
  license: { key: string | null };
}

export interface StatusPush {
  poller: { state: string; lastPollAt?: string; message?: string };
  dispatcher: { state: string; lastDeliveryAt?: string; message?: string };
  queue: { pending: number; delivered: number; failed: number };
  trayState: 'ok' | 'warn' | 'down' | 'paused';
}

export interface OpsTallyApi {
  getConfig(): Promise<PublicConfig>;
  setConfig(patch: Partial<PublicConfig>): Promise<PublicConfig>;
  listCompanies(): Promise<{ ok: boolean; companies?: { name: string }[]; error?: string }>;
  testTally(): Promise<{ ok: boolean; message?: string; error?: string }>;
  testWebhook(): Promise<{ ok: boolean; status?: number; error?: string }>;
  revealSecret(): Promise<string>;
  regenerateSecret(): Promise<string>;
  listDeliveries(): Promise<DeliveryRow[]>;
  retryEvent(id: string): Promise<boolean>;
  queueStats(): Promise<{ pending: number; delivered: number; failed: number }>;
  runPollNow(): Promise<boolean>;
  fullResync(): Promise<boolean>;
  fullVoucherResync(): Promise<boolean>;
  getSettings(): Promise<GlobalSettings>;
  setSettings(patch: Partial<GlobalSettings>): Promise<GlobalSettings>;
  onStatus(cb: (status: StatusPush) => void): () => void;
}

export const api: OpsTallyApi = (window as any).opstally;
