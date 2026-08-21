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
  const [voucherTypesDraft, setVoucherTypesDraft] = useState((config.voucherTypes ?? []).join(', '));

  const setInterval_ = (key: keyof PublicConfig['intervalsMinutes'], value: number) =>
    void patch({ intervalsMinutes: { ...config.intervalsMinutes, [key]: Math.max(1, value) } });

  const commitVoucherTypes = () => {
    const types = voucherTypesDraft
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    setVoucherTypesDraft(types.join(', '));
    void patch({ voucherTypes: types });
  };

  return (
    <div className="max-w-lg space-y-4">
      <h2 className="text-base font-semibold">Polling</h2>

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
              value={config.intervalsMinutes[key]}
              onChange={(e) => setInterval_(key, parseInt(e.target.value, 10) || 1)}
            />
          </label>
        ))}
      </div>

      <label className="block">
        <span className="text-sm text-slate-600">Voucher lookback window (days)</span>
        <input
          type="number"
          min={1}
          className="mt-1 w-32 rounded border px-3 py-2 text-sm"
          value={config.voucherLookbackDays}
          onChange={(e) => void patch({ voucherLookbackDays: parseInt(e.target.value, 10) || 90 })}
        />
      </label>

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
          Pause polling
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

      <div className="flex items-center gap-3 border-t pt-4">
        <button
          onClick={() => {
            void api.runPollNow();
            setNote('Poll queued');
          }}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Sync now
        </button>
        <button
          onClick={() => {
            if (window.confirm('Send the full stock list to your webhook as stock.snapshot events?')) {
              void api.fullResync();
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
                "Send this company's entire voucher history to your webhook as voucher.snapshot events? This is batched in date windows and may take a while on large companies."
              )
            ) {
              void api.fullVoucherResync();
              setNote('Full voucher resync queued — this can take a while on large histories');
            }
          }}
          className="rounded border px-4 py-2 text-sm hover:bg-slate-100"
        >
          Full voucher resync
        </button>
        <span className="text-sm text-slate-500">{note}</span>
      </div>
    </div>
  );
}
