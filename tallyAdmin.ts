import express, { Request, Response } from 'express';
import { createRequire } from 'module';
import TallyJob from '../models/TallyJob';

const require = createRequire(import.meta.url);
const router = express.Router();

const { resumeOnStartup } = require('../tally/queue');
const { syncSalesOrder, syncCustomer } = require('../tally/sync');
const { fetchStockLevels } = require('../tally/xml/stock');
const { runSync: runCustomerSync } = require('../tally/customerSync');
const { runStockSync } = require('../tally/jobs/stockSyncJob');
const { runReceiptPoll } = require('../tally/jobs/receiptPollJob');
const { handleTallyWebhook, getTallyEvents } = require('../tally/webhook');

// GET /api/tally/jobs
router.get('/jobs', async (req: Request, res: Response) => {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.status) filter.status = req.query.status;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const jobs = await TallyJob.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ ok: true, count: jobs.length, jobs });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/tally/jobs/stats
router.get('/jobs/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await TallyJob.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    const result: Record<string, number> = { pending: 0, success: 0, failed: 0, retrying: 0 };
    stats.forEach(({ _id, count }) => { result[_id] = count; });
    res.json({ ok: true, stats: result });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/tally/jobs/:id/retry
router.post('/jobs/:id/retry', async (req: Request, res: Response) => {
  try {
    const job = await TallyJob.findByIdAndUpdate(
      req.params.id,
      { status: 'pending', retries: 0, lastError: null, nextAttemptAt: null },
      { new: true }
    );
    if (!job) { res.status(404).json({ ok: false, error: 'Job not found' }); return; }
    resumeOnStartup();
    res.json({ ok: true, job });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/tally/relay/status
router.get('/relay/status', (_req: Request, res: Response) => {
  try {
    const { sendToTally } = require('../tally/bridge');
    sendToTally('<PING/>')
      .then(() => res.json({ ok: true, connected: true }))
      .catch(() => res.json({ ok: true, connected: false }));
  } catch {
    res.json({ ok: true, connected: false });
  }
});

// GET /api/tally/stock
router.get('/stock', async (_req: Request, res: Response) => {
  try {
    const items = await fetchStockLevels();
    res.json({ ok: true, items });
  } catch (err: any) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// POST /api/tally/sync/stock  — force immediate stock sync into OPS products
router.post('/sync/stock', async (_req: Request, res: Response) => {
  try {
    await runStockSync();
    res.json({ ok: true, message: 'Stock sync triggered' });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/tally/sync/customers  — force immediate Tally→OPS customer sync
router.post('/sync/customers', async (_req: Request, res: Response) => {
  try {
    const result = await runCustomerSync();
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/tally/test/sales-order
router.post('/test/sales-order', async (req: Request, res: Response) => {
  try {
    const order = {
      orderDate: new Date(),
      customerName: req.body.customerName || 'Test Customer',
      items: req.body.items || [{ name: 'Steel Rod 10mm', qty: 2, rate: 120, gstRate: 18 }],
      refId: req.body.refId || new (require('mongoose').Types.ObjectId)().toString(),
    };
    const job = await syncSalesOrder(order);
    res.json({ ok: true, jobId: job._id, type: job.type });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/tally/test/customer
router.post('/test/customer', async (req: Request, res: Response) => {
  try {
    const dealer = {
      dealer_name: req.body.name || 'Test Dealer Pvt Ltd',
      dealer_phone: [req.body.phone || '9999999999'],
      dealer_gstNo: req.body.gstin || '',
      dealer_addresses: [],
    };
    const job = await syncCustomer(dealer);
    res.json({ ok: true, jobId: job._id, type: job.type });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/tally/webhook  — TDL pushes from Tally Prime land here
// Fix 1: returns 401 if secret mismatch, 400 for bad payload
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const result = await handleTallyWebhook(req.body);
    if (!result.ok) {
      const statusCode = (result as any).status || 400;
      res.status(statusCode).json({ ok: false, error: result.error });
      return;
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/tally/sync/receipts  — Fix 6: manually trigger the TDL fallback receipt poll
router.post('/sync/receipts', async (_req: Request, res: Response) => {
  try {
    await runReceiptPoll();
    res.json({ ok: true, message: 'Receipt poll triggered' });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/tally/events  — recent events pushed from Tally via TDL
router.get('/events', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const events = await getTallyEvents(limit);
    res.json({ ok: true, count: events.length, events });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
