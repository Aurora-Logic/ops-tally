import { useEffect, useState } from 'react';
import { api, type PublicConfig, type StatusPush } from './api';
import ConnectionTab from './tabs/ConnectionTab';
import WebhookTab from './tabs/WebhookTab';
import PollingTab from './tabs/PollingTab';
import DeliveriesTab from './tabs/DeliveriesTab';

const TABS = ['Connection', 'Webhook', 'Polling', 'Deliveries'] as const;
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

  if (!config) return <div className="p-8 text-slate-500">Loading…</div>;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <span className={`inline-block h-3 w-3 rounded-full ${DOT[status?.trayState ?? 'paused']}`} />
          <h1 className="text-lg font-semibold">OpsTally Agent</h1>
        </div>
        <div className="text-sm text-slate-500">
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
            className={`px-4 py-2 text-sm font-medium ${
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
        {tab === 'Connection' && <ConnectionTab config={config} patch={patch} />}
        {tab === 'Webhook' && <WebhookTab config={config} patch={patch} />}
        {tab === 'Polling' && <PollingTab config={config} patch={patch} />}
        {tab === 'Deliveries' && <DeliveriesTab />}
      </main>

      {status?.poller.message && (
        <footer className="border-t bg-amber-50 px-6 py-2 text-sm text-amber-800">
          {status.poller.message}
        </footer>
      )}
    </div>
  );
}
