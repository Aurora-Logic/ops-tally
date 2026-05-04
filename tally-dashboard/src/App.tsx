import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity, AlertCircle, ArrowLeftRight, ArrowRight, ArrowRightLeft,
  CheckCircle2, ChevronDown, ChevronRight, Clock, Database,
  Info, Loader2, Package, RefreshCw, RotateCcw, Send,
  Terminal, Wifi, WifiOff, Zap, Bell,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────
interface Stats { pending: number; success: number; failed: number; retrying: number }
interface Job {
  _id: string; type: string; status: string; refId?: string;
  retries: number; maxRetries: number; lastError?: string;
  createdAt: string; syncedAt?: string;
  payload?: any; xml?: string;
}
interface StockItem { name: string; closingQty: number; unit: string; rate: number }
interface TallyEvent {
  _id: string;
  voucherType: string;
  party: string;
  amount: number;
  voucherNo: string;
  date: string;
  narration: string;
  receivedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────
function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
function fmtDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

const STATUS_BADGE: Record<string, string> = {
  success:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed:   'bg-red-50 text-red-600 border-red-200',
  retrying: 'bg-amber-50 text-amber-700 border-amber-200',
  pending:  'bg-zinc-100 text-zinc-600 border-zinc-200',
};
const TYPE_BADGE: Record<string, string> = {
  salesOrder: 'bg-blue-50 text-blue-700 border-blue-200',
  invoice:    'bg-violet-50 text-violet-700 border-violet-200',
  customer:   'bg-orange-50 text-orange-700 border-orange-200',
  dispatch:   'bg-teal-50 text-teal-700 border-teal-200',
};

// ─── API ──────────────────────────────────────────────────────────
const get  = (url: string) => fetch(url).then(r => r.json());
const post = (url: string, body?: object) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(r => r.json());

const api = {
  stats:          () => get('/api/tally/jobs/stats'),
  jobs:           (s?: string) => get(`/api/tally/jobs${s ? `?status=${s}` : ''}`),
  relay:          () => get('/api/tally/relay/status'),
  retry:          (id: string) => post(`/api/tally/jobs/${id}/retry`),
  stock:          () => get('/api/tally/stock'),
  syncStock:      () => post('/api/tally/sync/stock'),
  syncCustomers:  () => post('/api/tally/sync/customers'),
  pushProducts:   () => post('/api/tally/sync/products-to-tally'),
  testOrder:      (b: object) => post('/api/tally/test/sales-order', b),
  testCustomer:   (b: object) => post('/api/tally/test/customer', b),
  events:         (limit = 50) => get(`/api/tally/events?limit=${limit}`),
};

// ─── Stat card ────────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, className }: {
  label: string; value: number; icon: React.ElementType; className?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground capitalize">{label}</p>
            <p className="text-3xl font-semibold tracking-tight mt-1">{value}</p>
          </div>
          <div className={cn('rounded-full p-2', className)}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Job detail panel ─────────────────────────────────────────────
function JobDetail({ job, onClose }: { job: Job; onClose: () => void }) {
  const [showXml, setShowXml] = useState(false);
  const p = job.payload;

  return (
    <div className="rounded-md border bg-muted/20 mt-1 mb-2 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-background">
        <div className="flex items-center gap-2">
          <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium', TYPE_BADGE[job.type] ?? 'bg-zinc-50 text-zinc-700 border-zinc-200')}>{job.type}</span>
          <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium', STATUS_BADGE[job.status])}>{job.status}</span>
          <span className="text-xs text-muted-foreground font-mono">{job._id.slice(-12)}</span>
        </div>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onClose}>✕</Button>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
          <div><p className="text-muted-foreground mb-0.5">Created</p><p className="font-medium">{fmtDate(job.createdAt)}</p></div>
          <div><p className="text-muted-foreground mb-0.5">Synced</p><p className="font-medium">{fmtDate(job.syncedAt)}</p></div>
          <div><p className="text-muted-foreground mb-0.5">Retries</p><p className="font-medium">{job.retries}/{job.maxRetries}</p></div>
          {job.refId && <div><p className="text-muted-foreground mb-0.5">Ref ID</p><p className="font-mono font-medium">{job.refId.slice(-12)}</p></div>}
        </div>

        {job.lastError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{job.lastError}</div>
        )}

        {p && (
          <>
            <Separator />
            <div className="space-y-3">
              {(p.customerName || p.orderDate) && (
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {p.customerName && <div><p className="text-muted-foreground mb-0.5">Customer</p><p className="font-semibold text-sm">{p.customerName}</p></div>}
                  {p.orderDate && <div><p className="text-muted-foreground mb-0.5">Order Date</p><p className="font-medium">{fmtDate(p.orderDate)}</p></div>}
                </div>
              )}

              {Array.isArray(p.items) && p.items.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Items</p>
                  <div className="rounded-md border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Item</th>
                          <th className="px-3 py-2 text-right font-medium text-muted-foreground">Qty</th>
                          <th className="px-3 py-2 text-right font-medium text-muted-foreground">Rate ₹</th>
                          <th className="px-3 py-2 text-right font-medium text-muted-foreground">GST</th>
                          <th className="px-3 py-2 text-right font-medium text-muted-foreground">Total ₹</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.items.map((item: any, i: number) => {
                          const qty = item.qty ?? item.quantity ?? 0;
                          const rate = item.rate ?? item.priceAtTimeOfOrder ?? 0;
                          const gst = item.gstRate ?? 18;
                          const total = qty * rate * (1 + gst / 100);
                          return (
                            <tr key={i} className="border-b last:border-0">
                              <td className="px-3 py-2 font-medium">{item.name ?? String(item.itemId) ?? '—'}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{qty}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{rate}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{gst}%</td>
                              <td className="px-3 py-2 text-right tabular-nums font-medium">₹{total.toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t bg-muted/30">
                          <td colSpan={4} className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Grand Total (incl. GST)</td>
                          <td className="px-3 py-2 text-right tabular-nums text-sm font-semibold">
                            ₹{p.items.reduce((acc: number, item: any) => {
                              const qty = item.qty ?? item.quantity ?? 0;
                              const rate = item.rate ?? item.priceAtTimeOfOrder ?? 0;
                              const gst = item.gstRate ?? 18;
                              return acc + qty * rate * (1 + gst / 100);
                            }, 0).toFixed(2)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              {(p.dealer_name || p.dealer_phone || p.dealer_gstNo) && (
                <div className="grid grid-cols-3 gap-3 text-xs">
                  {p.dealer_name && <div><p className="text-muted-foreground">Name</p><p className="font-medium">{p.dealer_name}</p></div>}
                  {p.dealer_phone && <div><p className="text-muted-foreground">Phone</p><p className="font-medium">{[].concat(p.dealer_phone).join(', ')}</p></div>}
                  {p.dealer_gstNo && <div><p className="text-muted-foreground">GSTIN</p><p className="font-medium">{p.dealer_gstNo}</p></div>}
                </div>
              )}
            </div>
          </>
        )}

        {job.xml && (
          <>
            <Separator />
            <button onClick={() => setShowXml(v => !v)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              {showXml ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {showXml ? 'Hide' : 'Show'} Tally XML
            </button>
            {showXml && (
              <ScrollArea className="mt-2 h-48 rounded-md border bg-zinc-950 p-3">
                <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono">{job.xml}</pre>
              </ScrollArea>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Jobs tab ─────────────────────────────────────────────────────
function JobsTab() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api.jobs(filter === 'all' ? undefined : filter); setJobs(d.jobs ?? []); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const retry = async (id: string) => { setRetrying(id); await api.retry(id); await load(); setRetrying(null); };
  const toggle = (id: string) => setSelected(p => p === id ? null : id);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {['all','pending','retrying','failed','success'].map(f => (
          <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)} className="capitalize h-8 text-xs">{f}</Button>
        ))}
        <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="ml-auto h-8">
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1', loading && 'animate-spin')} />Refresh
        </Button>
      </div>

      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="h-10 w-8 px-2" />
              <th className="h-10 px-4 text-left font-medium text-muted-foreground">Type</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground">Status</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground hidden sm:table-cell">Customer / Name</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground hidden md:table-cell">Created</th>
              <th className="h-10 px-4 text-right font-medium text-muted-foreground">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="h-24 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" /></td></tr>
            ) : jobs.length === 0 ? (
              <tr><td colSpan={6} className="h-24 text-center text-muted-foreground text-sm">No jobs found</td></tr>
            ) : jobs.map(job => {
              const isOpen = selected === job._id;
              const customerName = job.payload?.customerName ?? job.payload?.dealer_name ?? '—';
              return (
                <React.Fragment key={job._id}>
                  <tr className={cn('border-b last:border-0 transition-colors cursor-pointer', isOpen ? 'bg-muted/40' : 'hover:bg-muted/30')} onClick={() => toggle(job._id)}>
                    <td className="px-2 text-center">
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground mx-auto" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground mx-auto" />}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium', TYPE_BADGE[job.type] ?? 'bg-zinc-50 text-zinc-700 border-zinc-200')}>{job.type}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium', STATUS_BADGE[job.status])}>{job.status}</span>
                      {job.lastError && <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[180px]" title={job.lastError}>{job.lastError}</p>}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-sm text-muted-foreground truncate max-w-[200px]">{customerName}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">{timeAgo(job.createdAt)}</td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      {(job.status === 'failed' || job.status === 'retrying') && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => retry(job._id)} disabled={retrying === job._id}>
                          {retrying === job._id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Retry
                        </Button>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b last:border-0">
                      <td colSpan={6} className="px-3 pb-2">
                        <JobDetail job={job} onClose={() => setSelected(null)} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Stock tab ────────────────────────────────────────────────────
function StockTab() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [syncMsg, setSyncMsg] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { const d = await api.stock(); if (d.ok) setItems(d.items); else setError(d.error); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const syncToOPS = async () => {
    setSyncing(true); setSyncMsg('');
    try {
      const d = await api.syncStock();
      setSyncMsg(d.ok ? '✓ Stock written to OPS product records' : `✗ ${d.error}`);
    } catch (e: any) { setSyncMsg(`✗ ${e.message}`); }
    finally { setSyncing(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="font-medium">Live Stock Levels</p>
          <p className="text-sm text-muted-foreground">Pulled from Tally Prime — auto-synced to OPS products every 30 min</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={syncToOPS} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <ArrowLeftRight className="h-4 w-4 mr-1" />}
            Sync to OPS Now
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {syncMsg && (
        <p className={cn('text-xs rounded-md px-3 py-2 border', syncMsg.startsWith('✓') ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200')}>
          {syncMsg}
        </p>
      )}
      {error && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}

      {items.length > 0 && (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="h-10 px-4 text-left font-medium text-muted-foreground">Item</th>
                <th className="h-10 px-4 text-right font-medium text-muted-foreground">Closing Qty</th>
                <th className="h-10 px-4 text-right font-medium text-muted-foreground hidden sm:table-cell">Unit</th>
                <th className="h-10 px-4 text-right font-medium text-muted-foreground">Rate ₹</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.name} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{item.name}</td>
                  <td className={cn('px-4 py-3 text-right tabular-nums font-medium', item.closingQty <= 0 ? 'text-destructive' : item.closingQty < 10 ? 'text-amber-600' : 'text-emerald-700')}>
                    {item.closingQty}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground hidden sm:table-cell">{item.unit}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">₹{item.rate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
          Click the refresh icon to fetch live stock from Tally
        </div>
      )}
    </div>
  );
}

// ─── Test sync tab ────────────────────────────────────────────────
function TestSyncTab() {
  const [soCustomer, setSoCustomer] = useState('Rahul Enterprises');
  const [soItem, setSoItem] = useState('Steel Rod 10mm');
  const [soQty, setSoQty]   = useState('5');
  const [soRate, setSoRate] = useState('120');
  const [soLoading, setSoLoading] = useState(false);
  const [soResult, setSoResult]   = useState<any>(null);

  const [cName, setCName]     = useState('Test Dealer Pvt Ltd');
  const [cPhone, setCPhone]   = useState('9999999999');
  const [cGstin, setCGstin]   = useState('');
  const [cLoading, setCLoading] = useState(false);
  const [cResult, setCResult]   = useState<any>(null);

  const triggerSalesOrder = async () => {
    setSoLoading(true); setSoResult(null);
    const r = await api.testOrder({ customerName: soCustomer, items: [{ name: soItem, qty: +soQty, rate: +soRate, gstRate: 18 }] });
    setSoResult(r); setSoLoading(false);
  };
  const triggerCustomer = async () => {
    setCLoading(true); setCResult(null);
    const r = await api.testCustomer({ name: cName, phone: cPhone, gstin: cGstin });
    setCResult(r); setCLoading(false);
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Send className="h-4 w-4" /> Test Sales Order</CardTitle>
          <CardDescription>Enqueues a sales order job to Tally</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground">Customer</label><Input value={soCustomer} onChange={e => setSoCustomer(e.target.value)} /></div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground">Item</label><Input value={soItem} onChange={e => setSoItem(e.target.value)} /></div>
            <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground">Qty</label><Input type="number" value={soQty} onChange={e => setSoQty(e.target.value)} /></div>
            <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground">Rate ₹</label><Input type="number" value={soRate} onChange={e => setSoRate(e.target.value)} /></div>
          </div>
          <Separator />
          <Button className="w-full" onClick={triggerSalesOrder} disabled={soLoading}>
            {soLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enqueue Job
          </Button>
          {soResult && <p className={cn('rounded-md p-2.5 text-xs font-mono', soResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600')}>{soResult.ok ? `✓ Job ${soResult.jobId?.slice(-8)}` : `✗ ${soResult.error}`}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Database className="h-4 w-4" /> Test Customer Sync</CardTitle>
          <CardDescription>Enqueues a customer ledger job</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground">Dealer Name</label><Input value={cName} onChange={e => setCName(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground">Phone</label><Input value={cPhone} onChange={e => setCPhone(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-xs font-medium text-muted-foreground">GSTIN (optional)</label><Input value={cGstin} onChange={e => setCGstin(e.target.value)} placeholder="27AABCU9603R1ZX" /></div>
          <Separator />
          <Button className="w-full" variant="secondary" onClick={triggerCustomer} disabled={cLoading}>
            {cLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enqueue Job
          </Button>
          {cResult && <p className={cn('rounded-md p-2.5 text-xs font-mono', cResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600')}>{cResult.ok ? `✓ Job ${cResult.jobId?.slice(-8)}` : `✗ ${cResult.error}`}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tally Events tab (TDL pushes from Tally Prime) ──────────────
const VOUCHER_COLORS: Record<string, string> = {
  Receipt:        'bg-emerald-50 text-emerald-700 border-emerald-200',
  Payment:        'bg-red-50 text-red-600 border-red-200',
  Sales:          'bg-blue-50 text-blue-700 border-blue-200',
  'Sales Invoice':'bg-blue-50 text-blue-700 border-blue-200',
};

function TallyEventsTab() {
  const [events, setEvents] = useState<TallyEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api.events(100); setEvents(d.events ?? []); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">Live events from Tally Prime</p>
          <p className="text-xs text-muted-foreground">
            Each row is one voucher save that TDL pushed to OPS. Auto-refreshes every 10 s.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="h-8">
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1', loading && 'animate-spin')} />Refresh
        </Button>
      </div>

      {events.length === 0 && !loading && (
        <div className="rounded-md border border-dashed py-12 text-center">
          <Bell className="h-6 w-6 mx-auto mb-2 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No events yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Events appear here when Tally saves a voucher with the TDL loaded
          </p>
        </div>
      )}

      {events.length > 0 && (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="h-10 px-4 text-left font-medium text-muted-foreground">Type</th>
                <th className="h-10 px-4 text-left font-medium text-muted-foreground">Party</th>
                <th className="h-10 px-4 text-right font-medium text-muted-foreground">Amount ₹</th>
                <th className="h-10 px-4 text-left font-medium text-muted-foreground hidden md:table-cell">Voucher No</th>
                <th className="h-10 px-4 text-left font-medium text-muted-foreground hidden lg:table-cell">Narration</th>
                <th className="h-10 px-4 text-right font-medium text-muted-foreground">Received</th>
              </tr>
            </thead>
            <tbody>
              {events.map(ev => (
                <tr key={ev._id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium', VOUCHER_COLORS[ev.voucherType] ?? 'bg-zinc-50 text-zinc-600 border-zinc-200')}>
                      {ev.voucherType}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium">{ev.party}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">₹{ev.amount.toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell font-mono text-xs">{ev.voucherNo || '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs hidden lg:table-cell max-w-[200px] truncate">{ev.narration || '—'}</td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground whitespace-nowrap">{timeAgo(ev.receivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Card className="border-amber-200 bg-amber-50/50">
        <CardContent className="pt-4 pb-4">
          <p className="text-xs font-medium text-amber-800 mb-1">How to activate TDL on Windows</p>
          <p className="text-xs text-amber-700 leading-relaxed">
            Copy <span className="font-mono">ops-sync.tdl</span> to the Windows machine →
            Open Tally Prime → <span className="font-mono">F12</span> → Advanced Configuration →
            TDL &amp; Add-on → Add TDP File Path → select the file → Accept.
            Every voucher save will then push here automatically.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Guide tab ────────────────────────────────────────────────────
function CodeBlock({ children }: { children: string }) {
  return (
    <div className="rounded-md bg-zinc-950 px-4 py-3 mt-2">
      <pre className="text-xs text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">{children}</pre>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-semibold">{n}</div>
      <div className="flex-1 pb-6">
        <p className="font-medium mb-1.5">{title}</p>
        <div className="text-sm text-muted-foreground space-y-1.5">{children}</div>
      </div>
    </div>
  );
}

function GuideTab() {
  const [stockSyncing, setStockSyncing]     = useState(false);
  const [customerSyncing, setCustomerSyncing] = useState(false);
  const [productsPushing, setProductsPushing] = useState(false);
  const [stockResult, setStockResult]       = useState('');
  const [customerResult, setCustomerResult] = useState('');
  const [productsResult, setProductsResult] = useState('');

  const forceSyncStock = async () => {
    setStockSyncing(true); setStockResult('');
    const d = await api.syncStock();
    setStockResult(d.ok ? '✓ Stock synced to OPS products' : `✗ ${d.error}`);
    setStockSyncing(false);
  };

  const forceSyncCustomers = async () => {
    setCustomerSyncing(true); setCustomerResult('');
    const d = await api.syncCustomers();
    setCustomerResult(d.ok ? `✓ ${d.upserted ?? 0} customers synced from Tally` : `✗ ${d.error}`);
    setCustomerSyncing(false);
  };

  const forcePushProducts = async () => {
    setProductsPushing(true); setProductsResult('');
    const d = await api.pushProducts();
    setProductsResult(d.ok ? `✓ ${d.message}` : `✗ ${d.error}`);
    setProductsPushing(false);
  };

  return (
    <ScrollArea className="h-[calc(100vh-280px)]">
      <div className="space-y-6 pr-2">

        {/* Bidirectional sync map */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ArrowRightLeft className="h-4 w-4" /> Bidirectional Sync Map</CardTitle>
            <CardDescription>Everything that flows between OPS and Tally, and when</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* OPS → Tally */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">OPS → Tally</span>
                <span className="text-xs text-muted-foreground">event-driven · near real-time (seconds)</span>
              </div>
              <div className="rounded-md border divide-y text-sm">
                {[
                  ['Dealer places order', 'Sales Order voucher created in Tally', '✅'],
                  ['Admin marks order InTransit', 'Sales Invoice voucher created in Tally', '✅'],
                  ['New dealer created in OPS', 'Customer ledger created in Tally (Sundry Debtor)', '✅'],
                  ['Dealer details updated in OPS', 'Tally customer ledger updated', '✅'],
                ].map(([trigger, result, status]) => (
                  <div key={trigger} className="flex items-start gap-3 px-3 py-2.5">
                    <span className="text-base leading-none mt-0.5">{status}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-xs">{trigger}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <ArrowRight className="h-3 w-3 flex-shrink-0" />{result}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tally → OPS */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">Tally → OPS</span>
                <span className="text-xs text-muted-foreground">scheduled · automatic</span>
              </div>
              <div className="rounded-md border divide-y text-sm">
                {[
                  ['Customer ledgers (Sundry Debtors)', 'OPS Dealer records upserted', 'Every 15 min, 08:00–20:00 IST', '✅'],
                  ['Stock closing balances', 'OPS product stockqty field updated', 'Every 30 min, always-on', '✅'],
                ].map(([source, result, schedule, status]) => (
                  <div key={source} className="flex items-start gap-3 px-3 py-2.5">
                    <span className="text-base leading-none mt-0.5">{status}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-xs">{source}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <ArrowRight className="h-3 w-3 flex-shrink-0" />{result}
                      </p>
                      <p className="text-xs text-muted-foreground/70 mt-0.5">{schedule}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* What needs TDL */}
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3">
              <p className="text-xs font-semibold text-amber-800 mb-1.5">Requires Tally TDL to add</p>
              <div className="space-y-1 text-xs text-amber-700">
                <p>• Payment received in Tally → mark order paid in OPS</p>
                <p>• Voucher confirmed/cancelled in Tally → update OPS order status</p>
                <p>• Real-time push from Tally on any save event</p>
              </div>
              <p className="text-xs text-amber-600 mt-2">All other flows above work with zero TDL — Tally's built-in XML API is sufficient.</p>
            </div>
          </CardContent>
        </Card>

        {/* Force sync controls */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Zap className="h-4 w-4" /> Force Sync Now</CardTitle>
            <CardDescription>Trigger any scheduled sync immediately without waiting</CardDescription>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-4">
            {/* OPS -> Tally Products */}
            <div className="space-y-2 col-span-full mb-2">
              <p className="text-sm font-medium">Push Products to Tally (Test Data Setup)</p>
              <p className="text-xs text-muted-foreground">Takes all products currently in OPS MongoDB and pushes them into Tally as Stock Items.</p>
              <Button size="sm" className="w-full bg-blue-600 hover:bg-blue-700 text-white" onClick={forcePushProducts} disabled={productsPushing}>
                {productsPushing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
                Push All OPS Products → Tally
              </Button>
              {productsResult && <p className={cn('text-xs', productsResult.startsWith('✓') ? 'text-emerald-700' : 'text-destructive')}>{productsResult}</p>}
            </div>
            
            <Separator className="col-span-full" />

            <div className="space-y-2">
              <p className="text-sm font-medium">Stock Levels</p>
              <p className="text-xs text-muted-foreground">Pulls closing balances from Tally and writes to OPS product stockqty</p>
              <Button size="sm" variant="outline" className="w-full" onClick={forceSyncStock} disabled={stockSyncing}>
                {stockSyncing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Package className="h-3.5 w-3.5 mr-1.5" />}
                Sync Stock → OPS
              </Button>
              {stockResult && <p className={cn('text-xs', stockResult.startsWith('✓') ? 'text-emerald-700' : 'text-destructive')}>{stockResult}</p>}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Customer Ledgers</p>
              <p className="text-xs text-muted-foreground">Pulls Sundry Debtor ledgers from Tally and upserts OPS Dealer records</p>
              <Button size="sm" variant="outline" className="w-full" onClick={forceSyncCustomers} disabled={customerSyncing}>
                {customerSyncing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Database className="h-3.5 w-3.5 mr-1.5" />}
                Sync Customers → OPS
              </Button>
              {customerResult && <p className={cn('text-xs', customerResult.startsWith('✓') ? 'text-emerald-700' : 'text-destructive')}>{customerResult}</p>}
            </div>
          </CardContent>
        </Card>

        {/* Architecture */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4" /> Architecture</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md bg-muted/50 border p-4 font-mono text-xs leading-loose text-muted-foreground">
              <span className="text-foreground font-semibold">OPS Frontend</span>{' '}(dealer places order / admin updates){'\n'}
              {'       ↓'}{'\n'}
              <span className="text-foreground font-semibold">OPS Backend</span>{' '}(Express · port 1000){'\n'}
              {'       ↓  saves TallyJob to MongoDB (queue + retry)'}{'\n'}
              <span className="text-foreground font-semibold">WebSocket Bridge</span>{' '}(/tally-relay){'\n'}
              {'       ↕  bidirectional WebSocket'}{'\n'}
              <span className="text-foreground font-semibold">Relay Agent</span>{' '}(Node.js on Windows · next to Tally){'\n'}
              {'       ↕  HTTP POST/GET to localhost:9000'}{'\n'}
              <span className="text-foreground font-semibold">Tally Prime</span>{' '}(XML HTTP Server · port 9000)
            </div>
          </CardContent>
        </Card>

        {/* Tally setup */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Terminal className="h-4 w-4" /> Tally Prime Setup</CardTitle>
            <CardDescription>One-time on the Windows machine — no TDL required</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative pl-4 border-l-2 border-muted">
              <Step n={1} title="Enable the XML HTTP Server">
                <p>Open Tally Prime → <span className="font-medium text-foreground">F12 Configure</span> → <span className="font-medium text-foreground">Advanced Configuration</span></p>
                <p>Set <span className="font-medium text-foreground">Enable Tally.NET Services → Yes</span></p>
                <p>Set <span className="font-medium text-foreground">HTTP Port → 9000</span></p>
              </Step>
              <Step n={2} title="Keep a company open">
                <p>Vouchers are posted to whichever company is <span className="font-medium text-foreground">currently active</span> in Tally when the relay runs.</p>
              </Step>
              <Step n={3} title="No TDL, no plugins">
                <p>The integration uses Tally's built-in <span className="font-medium text-foreground">IMPORTDATA</span> and <span className="font-medium text-foreground">ExportData</span> XML APIs. Sales Orders, Invoices, Customer ledgers, and Stock queries are all standard — zero customisation.</p>
              </Step>
            </div>
          </CardContent>
        </Card>

        {/* Relay setup */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Wifi className="h-4 w-4" /> Relay Agent (Windows)</CardTitle>
            <CardDescription>Bridges your VPS backend to Tally's local HTTP server</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative pl-4 border-l-2 border-muted">
              <Step n={1} title="Install Node.js on Windows">
                <p>Download from <span className="font-medium text-foreground">nodejs.org</span> — v18 or later.</p>
              </Step>
              <Step n={2} title="Copy tally-relay/ to the Windows machine">
                <CodeBlock>{`cd tally-relay
npm install`}</CodeBlock>
              </Step>
              <Step n={3} title="Create .env in tally-relay/">
                <CodeBlock>{`VPS_URL=ws://your-vps-ip:1000/tally-relay
TALLY_PORT=9000`}</CodeBlock>
              </Step>
              <Step n={4} title="Start the relay">
                <CodeBlock>{`node relay.js
# → Connected to VPS bridge`}</CodeBlock>
                <p>The relay badge in this dashboard turns <span className="text-emerald-600 font-medium">green</span>.</p>
              </Step>
              <Step n={5} title="Auto-start with PM2 (production)">
                <CodeBlock>{`npm install -g pm2
pm2 start relay.js --name tally-relay
pm2 save && pm2 startup`}</CodeBlock>
              </Step>
            </div>
          </CardContent>
        </Card>

        {/* API reference */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Info className="h-4 w-4" /> API Reference</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-14">Method</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Endpoint</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {[
                    ['GET',  '/api/tally/jobs',             'List all sync jobs'],
                    ['GET',  '/api/tally/jobs/stats',        'Job counts by status'],
                    ['POST', '/api/tally/jobs/:id/retry',    'Re-queue a failed job'],
                    ['GET',  '/api/tally/relay/status',      'Check relay connection'],
                    ['GET',  '/api/tally/stock',             'Fetch live stock from Tally'],
                    ['POST', '/api/tally/sync/stock',        'Force stock → OPS product sync'],
                    ['POST', '/api/tally/sync/customers',    'Force Tally ledgers → OPS dealers'],
                    ['POST', '/api/tally/test/sales-order',  'Create a test sales order'],
                    ['POST', '/api/tally/test/customer',     'Create a test customer sync'],
                  ].map(([m, path, desc]) => (
                    <tr key={path} className="hover:bg-muted/30">
                      <td className="px-3 py-2"><span className={cn('font-mono font-semibold', m === 'GET' ? 'text-blue-600' : 'text-violet-600')}>{m}</span></td>
                      <td className="px-3 py-2 font-mono text-foreground">{path}</td>
                      <td className="px-3 py-2 text-muted-foreground">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Troubleshooting */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlertCircle className="h-4 w-4" /> Troubleshooting</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              ['Relay badge shows offline', 'Make sure relay.js is running on Windows with the correct VPS_URL. Check that port 1000 on the VPS allows inbound WebSocket connections.'],
              ['Jobs stuck in pending / retrying', 'Relay is connected but Tally is not responding. Check that Tally is open, a company is selected, and the HTTP server is enabled on port 9000.'],
              ['Stock fetch returns error', 'The relay must be connected AND Tally open with at least one Stock Item in the active company.'],
              ['Customer name shows as ObjectId in Tally', 'The product lookup failed — ensure OPS products have the "item" field (product name) populated. The dealer name comes from User.name.'],
              ['Duplicate vouchers in Tally', 'Each job has a unique refId. If retried, a new voucher is created. Enable Tally\'s duplicate check under F11 → Accounting Features.'],
              ['Stock not updating in OPS products', 'Stock sync matches by exact item name. Make sure the product "item" field in OPS exactly matches the Stock Item name in Tally (case-insensitive).'],
            ].map(([q, a]) => (
              <div key={q} className="rounded-md border px-4 py-3">
                <p className="text-sm font-medium mb-1">{q}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{a}</p>
              </div>
            ))}
          </CardContent>
        </Card>

      </div>
    </ScrollArea>
  );
}

// ─── Root ─────────────────────────────────────────────────────────
export default function App() {
  const [stats, setStats] = useState<Stats>({ pending: 0, success: 0, failed: 0, retrying: 0 });
  const [relay, setRelay] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [s, r] = await Promise.all([api.stats(), api.relay()]);
      if (s.ok) setStats(s.stats);
      setRelay(r.connected ?? false);
    } finally { setRefreshing(false); }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <Activity className="h-5 w-5" />
            <span className="font-semibold">Tally Sync</span>
            <span className="hidden text-muted-foreground sm:inline">— OPS Dashboard</span>
          </div>
          <div className="flex items-center gap-3">
            {relay === null ? (
              <Badge variant="secondary"><Loader2 className="h-3 w-3 animate-spin mr-1" />Checking</Badge>
            ) : relay ? (
              <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium gap-1"><Wifi className="h-3 w-3" />Relay connected</Badge>
            ) : (
              <Badge className="bg-red-50 text-red-600 border border-red-200 font-medium gap-1"><WifiOff className="h-3 w-3" />Relay offline</Badge>
            )}
            <Button size="sm" variant="ghost" onClick={refresh} disabled={refreshing} className="h-8 w-8 p-0">
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="pending"  value={stats.pending}  icon={Clock}        className="bg-zinc-100 text-zinc-500" />
          <StatCard label="success"  value={stats.success}  icon={CheckCircle2} className="bg-emerald-50 text-emerald-600" />
          <StatCard label="failed"   value={stats.failed}   icon={AlertCircle}  className="bg-red-50 text-red-500" />
          <StatCard label="retrying" value={stats.retrying} icon={RefreshCw}    className="bg-amber-50 text-amber-600" />
        </div>

        <Separator />

        <Tabs defaultValue="jobs">
          <TabsList className="h-9">
            <TabsTrigger value="jobs"   className="gap-1.5 text-xs"><Activity className="h-3.5 w-3.5" />Jobs</TabsTrigger>
            <TabsTrigger value="stock"  className="gap-1.5 text-xs"><Package className="h-3.5 w-3.5" />Stock</TabsTrigger>
            <TabsTrigger value="events" className="gap-1.5 text-xs"><Bell className="h-3.5 w-3.5" />Tally Events</TabsTrigger>
            <TabsTrigger value="test"   className="gap-1.5 text-xs"><Send className="h-3.5 w-3.5" />Test Sync</TabsTrigger>
            <TabsTrigger value="guide"  className="gap-1.5 text-xs"><Info className="h-3.5 w-3.5" />Guide</TabsTrigger>
          </TabsList>
          <TabsContent value="jobs"><JobsTab /></TabsContent>
          <TabsContent value="stock"><StockTab /></TabsContent>
          <TabsContent value="events"><TallyEventsTab /></TabsContent>
          <TabsContent value="test"><TestSyncTab /></TabsContent>
          <TabsContent value="guide"><GuideTab /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
