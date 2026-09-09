import { useEffect, useState } from 'react';
import { api, type GlobalSettings, type PublicCompanyProfile, type PublicConfig } from '../api';

export default function SettingsTab({
  config: propConfig,
  patch: propPatch,
}: {
  config?: PublicConfig;
  patch?: (p: Partial<PublicConfig>) => Promise<void>;
}) {
  const [localConfig, setLocalConfig] = useState<PublicConfig | null>(propConfig ?? null);
  const [settings, setSettingsState] = useState<GlobalSettings | null>(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [verificationDays, setVerificationDays] = useState<number>(7);
  const [note, setNote] = useState('');
  const [companyNote, setCompanyNote] = useState('');
  const [error, setError] = useState('');
  const [busyCompanyId, setBusyCompanyId] = useState<string | null>(null);

  const config = propConfig ?? localConfig;

  const refreshConfig = async () => {
    try {
      const cfg = await api.getConfig();
      setLocalConfig(cfg);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (!propConfig) {
      void refreshConfig();
    }
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
  }, [propConfig]);

  const saveGlobal = async () => {
    try {
      const updated = await api.setSettings({
        license: { key: licenseKey.trim() || null },
        voucherTypesVerificationDays: Math.max(1, Math.min(365, Number(verificationDays) || 7)),
      });
      setSettingsState(updated);
      setNote('Saved settings');
      setTimeout(() => setNote(''), 3000);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAddCompany = async () => {
    setBusyCompanyId('add');
    try {
      await api.addCompany('New Company');
      await refreshConfig();
      if (propPatch) {
        const updated = await api.getConfig();
        await propPatch(updated);
      }
      setCompanyNote('Added new company profile');
      setTimeout(() => setCompanyNote(''), 3000);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusyCompanyId(null);
    }
  };

  const handleRemoveCompany = async (company: PublicCompanyProfile) => {
    if (!config) return;
    if (config.companies.length <= 1) {
      alert('You must keep at least one company profile.');
      return;
    }
    const confirmed = window.confirm(
      `Are you sure you want to delete "${company.name || 'Unnamed Company'}"?\n\nThis will remove the company from OpsTally and purge all its local pending event queues and sync watermarks.`
    );
    if (!confirmed) return;

    setBusyCompanyId(company.id);
    try {
      await api.removeCompany(company.id);
      await refreshConfig();
      if (propPatch) {
        const updated = await api.getConfig();
        await propPatch(updated);
      }
      setCompanyNote(`Removed "${company.name || 'Company'}"`);
      setTimeout(() => setCompanyNote(''), 3000);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusyCompanyId(null);
    }
  };

  const handleSetActive = async (id: string) => {
    setBusyCompanyId(id);
    try {
      const updated = await api.setActiveCompany(id);
      setLocalConfig(updated);
      if (propPatch) {
        await propPatch({ activeCompanyId: id });
      }
      setCompanyNote('Switched active company');
      setTimeout(() => setCompanyNote(''), 3000);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusyCompanyId(null);
    }
  };

  const handleToggleEnabled = async (companyId: string, enabled: boolean) => {
    if (!config) return;
    setBusyCompanyId(companyId);
    try {
      const updatedCompanies = config.companies.map((c) =>
        c.id === companyId ? { ...c, enabled } : c
      );
      if (propPatch) {
        await propPatch({ companies: updatedCompanies });
      } else {
        const updated = await api.setConfig({ companies: updatedCompanies });
        setLocalConfig(updated);
      }
      setCompanyNote(enabled ? 'Company sync enabled' : 'Company sync disabled');
      setTimeout(() => setCompanyNote(''), 3000);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusyCompanyId(null);
    }
  };

  const handleRenameCompany = async (companyId: string, name: string) => {
    if (!config) return;
    const updatedCompanies = config.companies.map((c) =>
      c.id === companyId ? { ...c, name } : c
    );
    if (propPatch) {
      await propPatch({
        companies: updatedCompanies,
        ...(config.activeCompanyId === companyId ? { company: name } : {}),
      });
    } else {
      const updated = await api.setConfig({
        companies: updatedCompanies,
        ...(config.activeCompanyId === companyId ? { company: name } : {}),
      });
      setLocalConfig(updated);
    }
  };

  if (error) return <div className="text-sm text-red-600 bg-red-50 p-4 rounded-lg border border-red-200">{error}</div>;
  if (!config || !settings) return <div className="text-sm text-slate-500">Loading settings…</div>;

  return (
    <div className="max-w-2xl space-y-8">
      {/* Companies Management Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <span>Manage Companies</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                {config.companies.length}
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Configure multiple Tally companies, enable/disable background sync, or delete unused profiles.
            </p>
          </div>
          <button
            onClick={() => void handleAddCompany()}
            disabled={busyCompanyId === 'add'}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            <span>+</span>
            <span>Add Company</span>
          </button>
        </div>

        {companyNote && (
          <div className="rounded bg-green-50 border border-green-200 px-3 py-1.5 text-xs font-medium text-green-800">
            ✓ {companyNote}
          </div>
        )}

        <div className="space-y-3">
          {config.companies.map((company) => {
            const isActive = company.id === config.activeCompanyId;
            const isBusy = busyCompanyId === company.id;

            return (
              <div
                key={company.id}
                className={`rounded-lg border p-4 transition-all ${
                  isActive
                    ? 'border-blue-300 bg-blue-50/30 shadow-sm ring-1 ring-blue-400/40'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        className="rounded border border-slate-300 px-2.5 py-1 text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 flex-1 max-w-sm"
                        value={company.name}
                        placeholder="Company name in Tally"
                        onChange={(e) => void handleRenameCompany(company.id, e.target.value)}
                      />

                      {isActive ? (
                        <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                          Active Selection
                        </span>
                      ) : (
                        <button
                          onClick={() => void handleSetActive(company.id)}
                          disabled={isBusy}
                          className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Set as Active
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-slate-600">Webhook:</span>
                        {company.webhookUrl ? (
                          <span className="text-slate-700 font-mono text-[11px] truncate max-w-xs" title={company.webhookUrl}>
                            {company.webhookUrl}
                          </span>
                        ) : (
                          <span className="text-amber-600 font-medium">Not configured</span>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <span className="font-medium text-slate-600">Intervals:</span>
                        <span>V: {company.intervalsMinutes?.vouchers ?? 15}m</span> · 
                        <span>S: {company.intervalsMinutes?.stock ?? 10}m</span> · 
                        <span>L: {company.intervalsMinutes?.ledgers ?? 30}m</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={company.enabled}
                        disabled={isBusy}
                        onChange={(e) => void handleToggleEnabled(company.id, e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span>Sync Enabled</span>
                    </label>

                    <button
                      onClick={() => void handleRemoveCompany(company)}
                      disabled={isBusy || config.companies.length <= 1}
                      title={config.companies.length <= 1 ? 'Cannot delete the only remaining company' : 'Delete this company profile'}
                      className="rounded border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Global Installation Settings */}
      <section className="space-y-4 border-t pt-6">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Global Installation Settings</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Cross-cutting settings for this OpsTally install (applies across all companies).
          </p>
        </div>

        <div className="space-y-4">
          <label className="block max-w-lg">
            <span className="text-xs font-medium text-slate-700">License Key</span>
            <input
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              placeholder="Not set"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
            />
          </label>

          <label className="block max-w-lg">
            <span className="text-xs font-medium text-slate-700">Voucher types idle verification interval (days)</span>
            <input
              type="number"
              min={1}
              max={365}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              value={verificationDays}
              onChange={(e) => setVerificationDays(parseInt(e.target.value, 10) || 1)}
            />
            <p className="mt-1 text-xs text-slate-500">
              When the delivery queue is idle (0 pending), OpsTally checks Tally Prime for new/modified voucher types at most once every N days.
            </p>
          </label>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => void saveGlobal()}
              className="rounded bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              Save Global Settings
            </button>
            {note && <span className="text-xs font-medium text-green-700">✓ {note}</span>}
          </div>
        </div>
      </section>
    </div>
  );
}
