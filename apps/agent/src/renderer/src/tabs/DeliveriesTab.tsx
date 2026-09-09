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

export default function DeliveriesTab({ activeCompanyId }: { activeCompanyId?: string }) {
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filterCompany, setFilterCompany] = useState<string>(activeCompanyId ?? 'all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  const showFeedback = (text: string, type: 'success' | 'info' | 'error' = 'success') => {
    setFeedback({ text, type });
    setTimeout(() => {
      setFeedback((current) => (current?.text === text ? null : current));
    }, 4000);
  };

  const refresh = async () => {
    const list = await api.listDeliveries(filterCompany === 'all' ? undefined : filterCompany);
    setRows(list);
  };

  const handleRefresh = async () => {
    setActionLoading('refresh');
    try {
      await refresh();
      showFeedback('Deliveries refreshed', 'info');
    } finally {
      setActionLoading(null);
    }
  };

  const handleResumeRetryAll = async () => {
    setActionLoading('resume');
    try {
      const res = await api.retryAllEvents(filterCompany === 'all' ? undefined : filterCompany);
      await refresh();
      showFeedback(`✓ Queue resumed — retrying ${res.count} event(s)`, 'success');
    } catch (err: any) {
      showFeedback(`✗ Failed to resume queue: ${err?.message || err}`, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancelPending = async () => {
    if (!window.confirm('Cancel pending events in queue?')) return;
    setActionLoading('cancel');
    try {
      const res = await api.cancelAllEvents(filterCompany === 'all' ? undefined : filterCompany);
      await refresh();
      showFeedback(`✓ Cancelled ${res.count} pending event(s)`, 'info');
    } catch (err: any) {
      showFeedback(`✗ Failed to cancel events: ${err?.message || err}`, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRetrySingle = async (id: string) => {
    setActionLoading(`retry-${id}`);
    try {
      await api.retryEvent(id);
      await refresh();
      showFeedback('✓ Event queued for immediate retry', 'success');
    } catch (err: any) {
      showFeedback(`✗ Retry failed: ${err?.message || err}`, 'error');
    } finally {
      setActionLoading(null);
    }
  };

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
  }, [filterCompany]);

  return (
    <div className="space-y-3">
      {feedback && (
        <div
          className={`flex items-center justify-between rounded px-3 py-2 text-xs font-medium transition-all ${
            feedback.type === 'error'
              ? 'bg-red-50 text-red-800 border border-red-200'
              : feedback.type === 'info'
              ? 'bg-blue-50 text-blue-800 border border-blue-200'
              : 'bg-green-50 text-green-800 border border-green-200'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-slate-600 font-bold ml-2"
          >
            ×
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">Recent events</h2>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <button
              onClick={() => setFilterCompany(activeCompanyId ?? 'all')}
              className={`rounded px-2 py-1 transition-colors ${
                filterCompany !== 'all' ? 'bg-blue-100 text-blue-700 font-medium' : 'hover:bg-slate-100'
              }`}
            >
              Current company
            </button>
            <button
              onClick={() => setFilterCompany('all')}
              className={`rounded px-2 py-1 transition-colors ${
                filterCompany === 'all' ? 'bg-blue-100 text-blue-700 font-medium' : 'hover:bg-slate-100'
              }`}
            >
              All companies
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {rows.some((r) => r.status === 'pending' || r.status === 'failed') && (
            <button
              onClick={() => void handleResumeRetryAll()}
              disabled={actionLoading === 'resume'}
              title="Unpause queue and immediately retry pending & failed events"
              className="flex items-center gap-1.5 rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 active:scale-95 transition-all disabled:opacity-50 cursor-pointer shadow-xs"
            >
              <span className={actionLoading === 'resume' ? 'animate-spin' : ''}>↻</span>
              <span>{actionLoading === 'resume' ? 'Resuming queue...' : 'Resume & Retry queue'}</span>
            </button>
          )}
          {rows.some((r) => r.status === 'pending') && (
            <button
              onClick={() => void handleCancelPending()}
              disabled={actionLoading === 'cancel'}
              className="flex items-center gap-1 rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
            >
              <span>{actionLoading === 'cancel' ? 'Cancelling...' : 'Cancel pending'}</span>
            </button>
          )}
          <button
            onClick={() => void handleRefresh()}
            disabled={actionLoading === 'refresh'}
            className="flex items-center gap-1 rounded border px-3 py-1.5 text-sm hover:bg-slate-100 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
          >
            <span className={actionLoading === 'refresh' ? 'animate-spin' : ''}>↻</span>
            <span>{actionLoading === 'refresh' ? 'Refreshing...' : 'Refresh'}</span>
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
                            onClick={() => void handleRetrySingle(r.id)}
                            disabled={actionLoading === `retry-${r.id}`}
                            className="rounded border px-2 py-1 text-xs hover:bg-slate-100 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
                          >
                            {actionLoading === `retry-${r.id}` ? 'Retrying...' : 'Retry'}
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
