import { useEffect, useState, useRef } from 'react';
import { api, type PublicConfig, type VoucherTypeInfo } from '../api';

const STANDARD_TYPES = [
  'Sales',
  'GST SALES',
  'Purchase',
  'GST PURCHASE',
  'Receipt',
  'Payment',
  'Journal',
  'Credit Note',
  'Debit Note',
];

const FALLBACK_AVAILABLE_TYPES: VoucherTypeInfo[] = [
  { name: 'Sales', parent: 'Sales' },
  { name: 'GST SALES', parent: 'Sales' },
  { name: 'Purchase', parent: 'Purchase' },
  { name: 'GST PURCHASE', parent: 'Purchase' },
  { name: 'Receipt', parent: 'Receipt' },
  { name: 'Payment', parent: 'Payment' },
  { name: 'Journal', parent: 'Journal' },
  { name: 'Contra', parent: 'Contra' },
  { name: 'Credit Note', parent: 'Credit Note' },
  { name: 'Debit Note', parent: 'Debit Note' },
  { name: 'Sales Order', parent: 'Sales Order' },
  { name: 'Purchase Order', parent: 'Purchase Order' },
  { name: 'Delivery Note', parent: 'Delivery Note' },
  { name: 'Receipt Note', parent: 'Receipt Note' },
  { name: 'Stock Journal', parent: 'Stock Journal' },
  { name: 'Physical Stock', parent: 'Physical Stock' },
  { name: 'Rejections In', parent: 'Rejections In' },
  { name: 'Rejections Out', parent: 'Rejections Out' },
];

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

  // Voucher Types State
  const [availableTypes, setAvailableTypes] = useState<VoucherTypeInfo[]>(FALLBACK_AVAILABLE_TYPES);
  const [lastVerifiedAt, setLastVerifiedAt] = useState<string | null>(null);
  const [typesLoading, setTypesLoading] = useState(false);
  const [refreshingTypes, setRefreshingTypes] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [customTypeInput, setCustomTypeInput] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedTypes: string[] = activeCompany?.voucherTypes ?? [];

  const loadWatermarks = async () => {
    try {
      const wm = await api.getWatermarks(companyId);
      setWatermarks(wm);
    } catch {}
  };

  const loadVoucherTypesFromDb = async () => {
    if (!companyId) return;
    setTypesLoading(true);
    try {
      const res = await api.getVoucherTypes(companyId);
      if (res && res.types && res.types.length > 0) {
        setAvailableTypes(res.types);
        setLastVerifiedAt(res.lastVerifiedAt);
      } else {
        // Use fallback if SQLite is empty initially
        setAvailableTypes(FALLBACK_AVAILABLE_TYPES);
        setLastVerifiedAt(res?.lastVerifiedAt ?? null);
      }
    } catch {
      setAvailableTypes(FALLBACK_AVAILABLE_TYPES);
    } finally {
      setTypesLoading(false);
    }
  };

  useEffect(() => {
    void loadWatermarks();
    void loadVoucherTypesFromDb();
  }, [companyId]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const setInterval_ = (key: keyof PublicConfig['intervalsMinutes'], value: number) => {
    const nextIntervals = { ...(activeCompany?.intervalsMinutes ?? { vouchers: 15, stock: 10, ledgers: 30 }), [key]: Math.max(1, value) };
    const updatedCompanies = config.companies.map((c) =>
      c.id === companyId ? { ...c, intervalsMinutes: nextIntervals } : c
    );
    void patch({ companies: updatedCompanies, intervalsMinutes: nextIntervals });
  };

  const updateSelectedVoucherTypes = (newTypes: string[]) => {
    const updatedCompanies = config.companies.map((c) =>
      c.id === companyId ? { ...c, voucherTypes: newTypes } : c
    );
    void patch({ companies: updatedCompanies, voucherTypes: newTypes });
  };

  const toggleType = (typeName: string) => {
    if (selectedTypes.includes(typeName)) {
      updateSelectedVoucherTypes(selectedTypes.filter((t) => t !== typeName));
    } else {
      updateSelectedVoucherTypes([...selectedTypes, typeName]);
    }
  };

  const selectStandardTypes = () => {
    const validStandard = availableTypes
      .map((t) => t.name)
      .filter((name) => STANDARD_TYPES.some((st) => st.toLowerCase() === name.toLowerCase()));
    const finalSelection = validStandard.length > 0 ? validStandard : STANDARD_TYPES;
    updateSelectedVoucherTypes(finalSelection);
  };

  const selectAllTypes = () => {
    updateSelectedVoucherTypes(availableTypes.map((t) => t.name));
  };

  const clearAllTypes = () => {
    updateSelectedVoucherTypes([]);
  };

  const handleAddCustomType = () => {
    const trimmed = customTypeInput.trim();
    if (!trimmed) return;
    if (!availableTypes.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
      setAvailableTypes((prev) => [...prev, { name: trimmed }].sort((a, b) => a.name.localeCompare(b.name)));
    }
    if (!selectedTypes.includes(trimmed)) {
      updateSelectedVoucherTypes([...selectedTypes, trimmed]);
    }
    setCustomTypeInput('');
  };

  const handleRefreshVoucherTypes = async () => {
    setRefreshingTypes(true);
    try {
      const res = await api.refreshVoucherTypes(companyId);
      if (res && res.types && res.types.length > 0) {
        setAvailableTypes(res.types);
        setLastVerifiedAt(res.lastVerifiedAt);
        setNote(`✓ Fetched ${res.types.length} voucher types from Tally Prime and saved to SQLite`);
      } else {
        setNote('No voucher types returned by Tally Prime (check if company is opened in Tally)');
      }
    } catch (err: any) {
      setNote(`✗ Failed to refresh voucher types: ${err?.message || err}`);
    } finally {
      setRefreshingTypes(false);
    }
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

  const filteredAvailableTypes = availableTypes.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.parent && t.parent.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const formatLastVerified = (iso: string | null) => {
    if (!iso) return 'Cached in local SQLite';
    try {
      const d = new Date(iso);
      return `Verified ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      return 'Cached in local SQLite';
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

      {/* Voucher Types Dropdown / Multi-Select Section */}
      <div className="space-y-2 rounded-lg border bg-white p-3.5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <label className="text-sm font-semibold text-slate-800 block">
              Voucher Types to Sync
            </label>
            <span className="text-[11px] text-slate-500">
              {formatLastVerified(lastVerifiedAt)} • {availableTypes.length} types in SQLite
            </span>
          </div>
          <button
            type="button"
            onClick={() => void handleRefreshVoucherTypes()}
            disabled={refreshingTypes || typesLoading}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 border border-blue-200 rounded px-2.5 py-1 hover:bg-blue-50 disabled:opacity-50"
            title="Fetch fresh list of voucher types from Tally Prime and save to SQLite"
          >
            {refreshingTypes ? 'Fetching...' : '↻ Refresh from Tally'}
          </button>
        </div>

        {/* Selected Types Badges */}
        <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2 bg-slate-50 rounded border border-slate-200">
          {selectedTypes.length === 0 ? (
            <span className="text-xs text-slate-400 italic">
              No filter set (All voucher types in Tally will be synced)
            </span>
          ) : (
            selectedTypes.map((type) => (
              <span
                key={type}
                className="inline-flex items-center gap-1 bg-white border border-slate-300 text-slate-700 px-2 py-0.5 rounded text-xs shadow-xs font-medium"
              >
                {type}
                <button
                  type="button"
                  onClick={() => toggleType(type)}
                  className="text-slate-400 hover:text-red-600 rounded-full font-bold ml-0.5 text-xs leading-none"
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>

        {/* Multi-Select Dropdown Component */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="w-full flex items-center justify-between rounded border px-3 py-2 text-sm bg-white hover:bg-slate-50 text-left text-slate-700"
          >
            <span>
              {selectedTypes.length === 0
                ? 'Select voucher types to filter (Click to open dropdown)'
                : `${selectedTypes.length} voucher type(s) selected`}
            </span>
            <span className="text-slate-400 text-xs">{dropdownOpen ? '▲' : '▼'}</span>
          </button>

          {dropdownOpen && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg p-2.5 space-y-2 max-h-80 overflow-hidden flex flex-col">
              {/* Search & Action Buttons */}
              <div className="space-y-1.5">
                <input
                  type="text"
                  placeholder="Search voucher types..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded border px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-blue-500"
                  autoFocus
                />
                <div className="flex items-center justify-between text-[11px] gap-1 pt-0.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={selectStandardTypes}
                      className="text-blue-600 hover:underline font-medium px-1"
                    >
                      Standard
                    </button>
                    <span className="text-slate-300">•</span>
                    <button
                      type="button"
                      onClick={selectAllTypes}
                      className="text-blue-600 hover:underline font-medium px-1"
                    >
                      All
                    </button>
                    <span className="text-slate-300">•</span>
                    <button
                      type="button"
                      onClick={clearAllTypes}
                      className="text-slate-500 hover:underline px-1"
                    >
                      Clear
                    </button>
                  </div>
                  <span className="text-slate-400">
                    {filteredAvailableTypes.length} of {availableTypes.length}
                  </span>
                </div>
              </div>

              {/* Scrollable list of voucher types with checkboxes */}
              <div className="overflow-y-auto max-h-44 space-y-1 border-t border-b py-1.5 divide-y divide-slate-50">
                {filteredAvailableTypes.length === 0 ? (
                  <div className="text-xs text-slate-400 p-2 text-center">
                    No matching voucher types found.
                  </div>
                ) : (
                  filteredAvailableTypes.map((t) => {
                    const checked = selectedTypes.includes(t.name);
                    return (
                      <label
                        key={t.name}
                        className={`flex items-center justify-between px-2 py-1.5 rounded text-xs cursor-pointer hover:bg-slate-100 ${
                          checked ? 'bg-blue-50/60 font-medium text-blue-900' : 'text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleType(t.name)}
                            className="rounded text-blue-600"
                          />
                          <span>{t.name}</span>
                        </div>
                        {t.parent && t.parent !== t.name && (
                          <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                            {t.parent}
                          </span>
                        )}
                      </label>
                    );
                  })
                )}
              </div>

              {/* Custom voucher type adder */}
              <div className="flex items-center gap-1.5 pt-1">
                <input
                  type="text"
                  placeholder="Add custom voucher type..."
                  value={customTypeInput}
                  onChange={(e) => setCustomTypeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCustomType();
                    }
                  }}
                  className="grow rounded border px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={handleAddCustomType}
                  disabled={!customTypeInput.trim()}
                  className="bg-slate-100 hover:bg-slate-200 border text-slate-700 px-2.5 py-1 rounded text-xs font-medium disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-[11px] text-slate-400">
          Only vouchers of the selected types are fetched from Tally Prime. If no types are selected, all voucher types will sync without filtering.
        </p>
      </div>

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
