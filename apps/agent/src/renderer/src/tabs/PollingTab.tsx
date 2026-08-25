import { useState } from 'react';
import { api, type PublicConfig } from '../api';

export default function PollingTab({
  config,
  patch,
}: {
  config: PublicConfig;
  patch: (p: Partial<PublicConfig>) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const activeCompany = config.activeCompany ?? config.companies.find((c) => c.id === config.activeCompanyId) ?? config.companies[0];
  const companyId = activeCompany?.id ?? config.activeCompanyId;

  const [voucherTypesDraft, setVoucherTypesDraft] = useState((activeCompany?.voucherTypes ?? []).join(', '));

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

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Polling intervals & triggers</h2>
        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
          {activeCompany?.name || 'Unnamed'}
        </span>
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

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <button
          onClick={() => {
            void api.runPollNow(companyId);
            setNote(`Poll queued for ${activeCompany?.name || 'company'}`);
          }}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Sync now
        </button>
        <button
          onClick={() => {
            if (window.confirm(`Send the full stock list for "${activeCompany?.name || 'company'}" to your webhook as stock.snapshot events?`)) {
              void api.fullResync(companyId);
              setNote('Full stock resync queued');
            }
          }}
          className="rounded border px-4 py-2 text-sm hover:bg-slate-100"
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
              setNote('Full voucher resync queued — this can take a while on large histories');
            }
          }}
          className="rounded border px-4 py-2 text-sm hover:bg-slate-100"
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
              setNote('Full ledger resync queued');
            }
          }}
          className="rounded border px-4 py-2 text-sm hover:bg-slate-100"
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
          className="rounded border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
        >
          Cancel dispatches
        </button>
        <span className="text-sm text-slate-500">{note}</span>
      </div>
    </div>
  );
}
