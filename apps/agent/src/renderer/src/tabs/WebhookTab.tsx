import { useState } from 'react';
import { api, type PublicConfig } from '../api';

export default function WebhookTab({
  config,
  patch,
}: {
  config: PublicConfig;
  patch: (p: Partial<PublicConfig>) => Promise<void>;
}) {
  const [secret, setSecret] = useState<string | null>(null);
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);

  const activeCompany = config.activeCompany ?? config.companies.find((c) => c.id === config.activeCompanyId) ?? config.companies[0];
  const companyId = activeCompany?.id ?? config.activeCompanyId;

  const reveal = async () => setSecret(await api.revealSecret(companyId));

  const regenerate = async () => {
    if (!window.confirm(`Regenerate the signing secret for "${activeCompany?.name || 'this company'}"? Your server connection secret must be updated or deliveries will fail verification.`)) return;
    setSecret(await api.regenerateSecret(companyId));
  };

  const copy = async () => {
    const s = secret ?? (await api.revealSecret(companyId));
    await navigator.clipboard.writeText(s);
    setResult('Secret copied to clipboard');
  };

  const test = async () => {
    setBusy(true);
    const res = await api.testWebhook(companyId);
    setResult(
      res.ok
        ? `✓ Delivered (HTTP ${res.status})`
        : `✗ ${res.error ?? `HTTP ${res.status}`}`
    );
    setBusy(false);
  };

  const updateWebhookUrl = (webhookUrl: string) => {
    const updatedCompanies = config.companies.map((c) =>
      c.id === companyId ? { ...c, webhookUrl } : c
    );
    void patch({ companies: updatedCompanies, webhookUrl });
  };

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Webhook settings</h2>
        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
          {activeCompany?.name || 'Unnamed'}
        </span>
      </div>

      <label className="block">
        <span className="text-sm text-slate-600">Webhook URL</span>
        <input
          className="mt-1 w-full rounded border px-3 py-2 text-sm"
          placeholder="https://your-server.example.com/api/v1/tally/webhook"
          value={activeCompany?.webhookUrl ?? ''}
          onChange={(e) => updateWebhookUrl(e.target.value)}
        />
      </label>

      <div>
        <span className="text-sm text-slate-600">Signing secret</span>
        <div className="mt-1 flex items-center gap-2">
          <code className="flex-1 truncate rounded border bg-slate-100 px-3 py-2 text-xs">
            {secret ?? '••••••••••••••••••••••••'}
          </code>
          <button onClick={() => void reveal()} className="rounded border px-3 py-2 text-sm hover:bg-slate-100">
            Reveal
          </button>
          <button onClick={() => void copy()} className="rounded border px-3 py-2 text-sm hover:bg-slate-100">
            Copy
          </button>
          <button onClick={() => void regenerate()} className="rounded border px-3 py-2 text-sm text-red-600 hover:bg-red-50">
            Regenerate
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Every payload carries an <code>X-Tally-Signature</code> header — hex HMAC-SHA256 of the raw
          body with this secret. Verify it on your server before trusting the event.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => void test()}
          disabled={busy || !activeCompany?.webhookUrl}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Send test event
        </button>
        <span className={`text-sm ${result.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
          {result}
        </span>
      </div>
    </div>
  );
}
