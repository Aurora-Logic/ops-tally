import { useEffect, useState } from 'react';
import { api, type PublicConfig, type StatusPush } from './api';
import ErrorBoundary from './ErrorBoundary';
import ConnectionTab from './tabs/ConnectionTab';
import WebhookTab from './tabs/WebhookTab';
import PollingTab from './tabs/PollingTab';
import DeliveriesTab from './tabs/DeliveriesTab';
import SettingsTab from './tabs/SettingsTab';

const TABS = ['Connection', 'Webhook', 'Polling', 'Deliveries', 'Settings'] as const;
type Tab = (typeof TABS)[number];

const DOT: Record<StatusPush['trayState'], string> = {
  ok: 'bg-green-500',
  warn: 'bg-yellow-500',
  down: 'bg-red-500',
  paused: 'bg-slate-400',
};

export default function App() {
  const [tab, setTab] = useState<Tab>('Connection');
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [status, setStatus] = useState<StatusPush | null>(null);

  useEffect(() => {
    void api.getConfig().then(setConfig);
    return api.onStatus(setStatus);
  }, []);

  const patch = async (p: Partial<PublicConfig>) => {
    setConfig(await api.setConfig(p));
  };

  const handleAddCompany = async () => {
    const pub = await api.addCompany('New Company');
    const updated = await api.getConfig();
    setConfig(updated);
  };

  const handleRemoveCompany = async (id: string) => {
    const active = config?.companies.find((c) => c.id === id);
    if (!window.confirm(`Are you sure you want to remove "${active?.name || 'this company'}"?`)) return;
    await api.removeCompany(id);
    const updated = await api.getConfig();
    setConfig(updated);
  };

  const handleSwitchCompany = async (id: string) => {
    const updated = await api.setActiveCompany(id);
    setConfig(updated);
  };

  if (!config) return <div className="p-8 text-slate-500">Loading…</div>;

  const activeCompany = config.activeCompany ?? config.companies.find((c) => c.id === config.activeCompanyId) ?? config.companies[0];

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <div className="flex items-center gap-2.5">
          <img src="/icon.svg" alt="OpsTally Logo" className="h-6 w-6 rounded shadow-sm" />
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[status?.trayState ?? 'paused']}`} />
          <h1 className="text-base font-bold tracking-tight text-slate-800">OpsTally Agent</h1>

          <div className="ml-4 flex items-center gap-2 rounded-lg bg-slate-100 p-1">
            <span className="text-xs font-semibold uppercase text-slate-500 pl-2">Company:</span>
            <select
              className="rounded bg-white border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-800 shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={config.activeCompanyId}
              onChange={(e) => void handleSwitchCompany(e.target.value)}
            >
              {config.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || 'Unnamed Company'} {!c.enabled ? '(Disabled)' : ''}
                </option>
              ))}
            </select>

            <button
              onClick={() => void handleAddCompany()}
              title="Add another company profile"
              className="flex items-center gap-1 rounded border border-dashed border-slate-400 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            >
              <span>+</span>
              <span>Add</span>
            </button>

            {config.companies.length > 1 && (
              <button
                onClick={() => void handleRemoveCompany(config.activeCompanyId)}
                title="Remove current company profile"
                className="rounded border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        <div className="text-xs text-slate-500">
          {status
            ? `queue: ${status.queue.pending} pending · ${status.queue.delivered} delivered · ${status.queue.failed} failed`
            : ''}
        </div>
      </header>

      <nav className="flex gap-1 border-b bg-white px-4">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto p-6">
        <ErrorBoundary key={`${tab}-${config.activeCompanyId}`}>
          {tab === 'Connection' && <ConnectionTab config={config} patch={patch} />}
          {tab === 'Webhook' && <WebhookTab config={config} patch={patch} />}
          {tab === 'Polling' && <PollingTab config={config} patch={patch} />}
          {tab === 'Deliveries' && <DeliveriesTab activeCompanyId={config.activeCompanyId} />}
          {tab === 'Settings' && <SettingsTab config={config} patch={patch} />}
        </ErrorBoundary>
      </main>

      {(status?.dispatcher.message || status?.poller.message) && (
        <footer className="border-t bg-amber-50 px-6 py-2 text-xs text-amber-900 flex items-center justify-between">
          <span>{status?.dispatcher.message || status?.poller.message}</span>
          {status?.dispatcher.state === 'retrying' && (
            <button
              onClick={() => void api.resumeQueue()}
              className="ml-4 rounded border border-amber-300 bg-white px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
            >
              Resume now
            </button>
          )}
        </footer>
      )}
    </div>
  );
}
