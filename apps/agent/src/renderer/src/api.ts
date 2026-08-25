export interface PublicCompanyProfile {
  id: string;
  name: string;
  enabled: boolean;
  webhookUrl: string;
  intervalsMinutes: { vouchers: number; stock: number; ledgers: number };
  voucherTypes: string[];
}

export interface PublicConfig {
  tallyHost: string;
  tallyPort: number;
  activeCompanyId: string;
  companies: PublicCompanyProfile[];
  paused: boolean;
  openAtLogin: boolean;

  // Active company convenience fields
  activeCompany?: PublicCompanyProfile;
  company: string;
  webhookUrl: string;
  intervalsMinutes: { vouchers: number; stock: number; ledgers: number };
  voucherTypes: string[];
}

export interface DeliveryRow {
  id: string;
  company_id?: string;
  event: string;
  created_at: string;
  status: 'pending' | 'delivered' | 'failed' | 'cancelled';
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
  addCompany(name?: string): Promise<PublicCompanyProfile>;
  removeCompany(companyId: string): Promise<boolean>;
  setActiveCompany(companyId: string): Promise<PublicConfig>;
  listCompanies(): Promise<{ ok: boolean; companies?: { name: string }[]; error?: string }>;
  testTally(): Promise<{ ok: boolean; message?: string; error?: string }>;
  testWebhook(companyId?: string): Promise<{ ok: boolean; status?: number; error?: string }>;
  revealSecret(companyId?: string): Promise<string>;
  regenerateSecret(companyId?: string): Promise<string>;
  listDeliveries(companyId?: string): Promise<DeliveryRow[]>;
  retryEvent(id: string): Promise<boolean>;
  cancelAllEvents(companyId?: string): Promise<{ ok: boolean; count: number }>;
  queueStats(companyId?: string): Promise<{ pending: number; delivered: number; failed: number }>;
  runPollNow(companyId?: string): Promise<boolean>;
  fullResync(companyId?: string): Promise<boolean>;
  fullVoucherResync(companyId?: string): Promise<boolean>;
  fullLedgerResync(companyId?: string): Promise<boolean>;
  getSettings(): Promise<GlobalSettings>;
  setSettings(patch: Partial<GlobalSettings>): Promise<GlobalSettings>;
  onStatus(cb: (status: StatusPush) => void): () => void;
}

export const api: OpsTallyApi = (window as any).opstally;

