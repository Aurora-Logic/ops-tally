import { Fragment, useEffect, useState } from 'react';
import { api, type DeliveryRow } from '../api';

const BADGE: Record<DeliveryRow['status'], string> = {
  delivered: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-700',
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path d="M7 4l6 6-6 6" />
    </svg>
  );
}

export default function DeliveriesTab() {
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const refresh = async () => setRows(await api.listDeliveries());

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Recent events</h2>
        <div className="flex items-center gap-2">
          {rows.some((r) => r.status === 'pending') && (
            <button
              onClick={async () => {
                if (window.confirm('Cancel all pending events in queue?')) {
                  await api.cancelAllEvents();
                  await refresh();
                }
              }}
              className="rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              Cancel pending
            </button>
          )}
          <button onClick={() => void refresh()} className="rounded border px-3 py-1.5 text-sm hover:bg-slate-100">
            Refresh
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No events yet — they appear here once polling detects changes.</p>
      ) : (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500">
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Products</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Attempts</th>
                <th className="px-3 py-2">Last error</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const hasProducts = !!r.products && r.products.length > 0;
                const isOpen = expanded.has(r.id);
                return (
                  <Fragment key={r.id}>
                    <tr className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono text-xs">{r.event}</td>
                      <td className="px-3 py-2 text-xs">
                        {hasProducts ? (
                          <button
                            onClick={() => toggleExpanded(r.id)}
                            className="flex items-center gap-1 text-slate-700 hover:text-slate-950"
                          >
                            <ChevronIcon open={isOpen} />
                            {r.products!.length} item{r.products!.length === 1 ? '' : 's'}
                          </button>
                        ) : (
                          ''
                        )}
                      </td>
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
                        {(r.status === 'failed' || r.status === 'cancelled') && (
                          <button
                            onClick={() => void api.retryEvent(r.id).then(refresh)}
                            className="rounded border px-2 py-1 text-xs hover:bg-slate-100"
                          >
                            Retry
                          </button>
                        )}
                      </td>
                    </tr>
                    {hasProducts && isOpen && (
                      <tr className="border-b bg-slate-50 last:border-0">
                        <td></td>
                        <td colSpan={6} className="px-3 py-2 text-xs text-slate-700">
                          <div className="flex flex-wrap gap-1.5">
                            {r.products!.map((name, i) => (
                              <span key={i} className="rounded bg-white border px-2 py-0.5">
                                {name}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
