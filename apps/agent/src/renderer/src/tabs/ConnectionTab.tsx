import { useState } from 'react';
import { api, type PublicConfig } from '../api';

export default function ConnectionTab({
  config,
  patch,
}: {
  config: PublicConfig;
  patch: (p: Partial<PublicConfig>) => Promise<void>;
}) {
  const [companies, setCompanies] = useState<string[]>([]);
  const [result, setResult] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const test = async () => {
    setBusy(true);
    const res = await api.testTally();
    setResult(res.ok ? `✓ ${res.message}` : `✗ ${res.error}`);
    setBusy(false);
  };

  const loadCompanies = async () => {
    setBusy(true);
    const res = await api.listCompanies();
    if (res.ok && res.companies) {
      setCompanies(res.companies.map((c) => c.name));
      setResult(res.companies.length ? '' : 'No companies loaded in Tally');
    } else {
      setResult(`✗ ${res.error}`);
    }
    setBusy(false);
  };

  return (
    <div className="max-w-lg space-y-4">
      <h2 className="text-base font-semibold">Tally connection</h2>
      <div className="grid grid-cols-3 gap-3">
        <label className="col-span-2 block">
          <span className="text-sm text-slate-600">Host</span>
          <input
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
            value={config.tallyHost}
            onChange={(e) => void patch({ tallyHost: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-600">Port</span>
          <input
            type="number"
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
            value={config.tallyPort}
            onChange={(e) => void patch({ tallyPort: parseInt(e.target.value, 10) || 9000 })}
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm text-slate-600">Company</span>
        <div className="mt-1 flex gap-2">
          {companies.length > 0 ? (
            <select
              className="w-full rounded border px-3 py-2 text-sm"
              value={config.company}
              onChange={(e) => void patch({ company: e.target.value })}
            >
              <option value="">— select —</option>
              {companies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="w-full rounded border px-3 py-2 text-sm"
              placeholder="Company name as shown in Tally"
              value={config.company}
              onChange={(e) => void patch({ company: e.target.value })}
            />
          )}
          <button
            onClick={() => void loadCompanies()}
            disabled={busy}
            className="whitespace-nowrap rounded border px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-50"
          >
            Load from Tally
          </button>
        </div>
      </label>

      <div className="flex items-center gap-3">
        <button
          onClick={() => void test()}
          disabled={busy}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Test connection
        </button>
        <span className={`text-sm ${result.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
          {result}
        </span>
      </div>
    </div>
  );
}
