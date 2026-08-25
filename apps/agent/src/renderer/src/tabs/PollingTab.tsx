import { useEffect, useState } from 'react';
import { api, type PublicConfig } from '../api';

export default function PollingTab({
  config,
  patch,
}: {
  config: PublicConfig;
  patch: (p: Partial<PublicConfig>) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [watermarks, setWatermarks] = useState<{ vouchers: number; stock: number; ledgers: number } | null>(null);

  const activeCompany = config.activeCompany ?? config.companies.find((c) => c.id === config.activeCompanyId) ?? config.companies[0];
  const companyId = activeCompany?.id ?? config.activeCompanyId;

  const [voucherTypesDraft, setVoucherTypesDraft] = useState((activeCompany?.voucherTypes ?? []).join(', '));

  const loadWatermarks = async () => {
    try {
      const wm = await api.getWatermarks(companyId);
      setWatermarks(wm);
    } catch {}
  };

  useEffect(() => {
    void loadWatermarks();
  }, [companyId]);

  const setInterval_ = (key: keyof PublicConfig['intervalsMinutes'], value: number) => {
    const nextIntervals = { ...(activeCompany?.intervalsMinutes ?? { vouchers: 15, stock: 10, ledgers: 30 }), [key]: Math.max(1, value) };
    const updatedCompanies = config.companies.map((c) =>
      c.id === companyId ? { ...c, intervalsMinutes: nextIntervals } : c
    );
    void patch({ companies: updatedCompanies, intervalsMinutes: nextIntervals });
  };

  const commitVoucherTypes = () => {
    const types = voucherTypesDraft
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    setVoucherTypesDraft(types.join(', '));
    const updatedCompanies = config.companies.map((c) =>
      c.id === companyId ? { ...c, voucherTypes: types } : c
    );
    void patch({ companies: updatedCompanies, voucherTypes: types });
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setNote('Connecting to Tally Prime & checking changes...');
    try {
      const res = await api.runPollNow(companyId);
      setNote(res.message);
      if (res.watermarks) setWatermarks(res.watermarks);
    } catch (err: any) {
      setNote(`✗ Sync failed: ${err?.message || err}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Polling & Sync Engine</h2>
        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
          {activeCompany?.name || 'Unnamed'}
        </span>
      </div>

      {/* Sync Status & Watermarks Info Card */}
      <div className="rounded-lg border bg-white p-3.5 shadow-sm space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold uppercase text-slate-500">
          <span>Synchronization Status</span>
          <span className="text-green-600 flex items-center gap-1 font-medium lowercase">
            <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
            active monitoring
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
          <div className="rounded bg-slate-50 border p-2">
            <span className="text-slate-500 block">Voucher AlterID</span>
            <span className="font-semibold text-slate-800 font-mono text-sm">
              {watermarks?.vouchers ? watermarks.vouchers.toLocaleString() : 'Baseline'}
            </span>
          </div>
          <div className="rounded bg-slate-50 border p-2">
            <span className="text-slate-500 block">Stock Items</span>
            <span className="font-semibold text-slate-800 font-mono text-sm">
              {watermarks?.stock ? watermarks.stock.toLocaleString() : 'Monitored'}
            </span>
          </div>
          <div className="rounded bg-slate-50 border p-2">
            <span className="text-slate-500 block">Ledger Accounts</span>
            <span className="font-semibold text-slate-800 font-mono text-sm">
              {watermarks?.ledgers ? watermarks.ledgers.toLocaleString() : 'Monitored'}
            </span>
          </div>
        </div>
        <p className="text-[11px] text-slate-400">
          Incremental sync automatically detects whenever vouchers, closing balances, or prices are modified in Tally Prime.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {(
          [
            ['vouchers', 'Vouchers (min)'],
            ['stock', 'Stock (min)'],
            ['ledgers', 'Ledgers (min)'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block">
            <span className="text-sm text-slate-600">{label}</span>
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={activeCompany?.intervalsMinutes?.[key] ?? 15}
              onChange={(e) => setInterval_(key, parseInt(e.target.value, 10) || 1)}
            />
          </label>
        ))}
      </div>

      <label className="block">
        <span className="text-sm text-slate-600">Voucher types to sync (comma-separated)</span>
        <input
          className="mt-1 w-full rounded border px-3 py-2 text-sm"
          placeholder="Sales, Purchase, Receipt, Payment, Journal, Credit Note, Debit Note"
          value={voucherTypesDraft}
          onChange={(e) => setVoucherTypesDraft(e.target.value)}
          onBlur={commitVoucherTypes}
        />
        <p className="mt-1 text-xs text-slate-500">
          Only these voucher types are fetched from Tally at all — everything else is filtered out before it
          ever leaves Tally's own query. Empty means no restriction (every type syncs). Names must match Tally
          exactly, e.g. "Credit Note".
        </p>
      </label>

      <div className="flex items-center gap-3 pt-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.paused}
            onChange={(e) => void patch({ paused: e.target.checked })}
          />
          Pause all polling
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.openAtLogin}
            onChange={(e) => void patch({ openAtLogin: e.target.checked })}
          />
          Start with Windows
        </label>
      </div>

      <div className="space-y-2 border-t pt-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => void handleSyncNow()}
            disabled={syncing}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {syncing ? 'Checking Tally...' : 'Sync now (Check changes)'}
          </button>
          <button
            onClick={() => {
              if (window.confirm(`Send the full stock list for "${activeCompany?.name || 'company'}" to your webhook as stock.snapshot events?`)) {
                void api.fullResync(companyId);
                setNote('Full stock resync queued — check Deliveries tab');
              }
            }}
            className="rounded border px-3.5 py-2 text-xs font-medium hover:bg-slate-100"
          >
            Full stock resync
          </button>
          <button
            onClick={() => {
              if (
                window.confirm(
                  `Send "${activeCompany?.name || 'company'}" entire voucher history to your webhook as voucher.snapshot events? This is batched in date windows and may take a while on large companies.`
                )
              ) {
                void api.fullVoucherResync(companyId);
                setNote('Full voucher resync queued — check Deliveries tab');
              }
            }}
            className="rounded border px-3.5 py-2 text-xs font-medium hover:bg-slate-100"
          >
            Full voucher resync
          </button>
          <button
            onClick={() => {
              if (
                window.confirm(
                  `Send every ledger for "${activeCompany?.name || 'company'}" — parties included, with balances and contact details — to your webhook as ledger.snapshot events?`
                )
              ) {
                void api.fullLedgerResync(companyId);
                setNote('Full ledger resync queued — check Deliveries tab');
              }
            }}
            className="rounded border px-3.5 py-2 text-xs font-medium hover:bg-slate-100"
          >
            Full ledger resync
          </button>
          <button
            onClick={async () => {
              if (window.confirm(`Cancel all pending event dispatches for "${activeCompany?.name || 'company'}" currently in the queue?`)) {
                const res = await api.cancelAllEvents(companyId);
                setNote(`Cancelled ${res.count} pending event(s)`);
              }
            }}
            className="rounded border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            Cancel dispatches
          </button>
        </div>

        {note && (
          <div className={`text-xs p-2 rounded ${note.startsWith('✗') ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-800'}`}>
            {note}
          </div>
        )}
      </div>
    </div>
  );
}
