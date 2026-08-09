import { useEffect, useState } from 'react';
import { api, type DeliveryRow } from '../api';

const BADGE: Record<DeliveryRow['status'], string> = {
  delivered: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  failed: 'bg-red-100 text-red-700',
};

export default function DeliveriesTab() {
  const [rows, setRows] = useState<DeliveryRow[]>([]);

  const refresh = async () => setRows(await api.listDeliveries());

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Recent events</h2>
        <button onClick={() => void refresh()} className="rounded border px-3 py-1.5 text-sm hover:bg-slate-100">
          Refresh
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No events yet — they appear here once polling detects changes.</p>
      ) : (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500">
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Attempts</th>
                <th className="px-3 py-2">Last error</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{r.event}</td>
                  <td className="px-3 py-2 text-xs">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${BADGE[r.status]}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">{r.attempts}</td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-xs text-red-600" title={r.last_error ?? ''}>
                    {r.last_error ?? ''}
                  </td>
                  <td className="px-3 py-2">
                    {r.status === 'failed' && (
                      <button
                        onClick={() => void api.retryEvent(r.id).then(refresh)}
                        className="rounded border px-2 py-1 text-xs hover:bg-slate-100"
                      >
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
