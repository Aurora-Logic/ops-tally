import { useEffect, useState } from 'react';
import { api, type GlobalSettings } from '../api';

export default function SettingsTab() {
  const [settings, setSettingsState] = useState<GlobalSettings | null>(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [verificationDays, setVerificationDays] = useState<number>(7);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (typeof api.getSettings !== 'function') {
      setError('Settings bridge unavailable — quit the Agent fully from the tray icon and reopen it.');
      return;
    }
    api
      .getSettings()
      .then((s) => {
        setSettingsState(s);
        setLicenseKey(s.license?.key ?? '');
        setVerificationDays(s.voucherTypesVerificationDays ?? 7);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const save = async () => {
    try {
      const updated = await api.setSettings({
        license: { key: licenseKey.trim() || null },
        voucherTypesVerificationDays: Math.max(1, Math.min(365, Number(verificationDays) || 7)),
      });
      setSettingsState(updated);
      setNote('Saved');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!settings) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="max-w-lg space-y-4">
      <h2 className="text-base font-semibold">Settings</h2>
      <p className="text-sm text-slate-500">
        Global settings for this install — not tied to any one Tally connection.
      </p>

      <label className="block">
        <span className="text-sm text-slate-600">License key</span>
        <input
          className="mt-1 w-full rounded border px-3 py-2 text-sm"
          placeholder="Not set"
          value={licenseKey}
          onChange={(e) => setLicenseKey(e.target.value)}
        />
      </label>

      <label className="block">
        <span className="text-sm text-slate-600">Voucher types verification interval (days)</span>
        <input
          type="number"
          min={1}
          max={365}
          className="mt-1 w-full rounded border px-3 py-2 text-sm"
          value={verificationDays}
          onChange={(e) => setVerificationDays(parseInt(e.target.value, 10) || 1)}
        />
        <p className="mt-1 text-xs text-slate-500">
          When the event delivery queue is idle (0 pending deliverables), OpsTally checks Tally Prime for new or modified voucher types at most once every N days to avoid unnecessary load.
        </p>
      </label>

      <div className="flex items-center gap-3">
        <button
          onClick={() => void save()}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Save
        </button>
        <span className="text-sm text-slate-500">{note}</span>
      </div>

      <p className="text-xs text-slate-500">More global settings will land here later.</p>
    </div>
  );
}
