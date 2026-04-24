const mongoose = require('mongoose');
const https = require('https');
const http = require('http');
const TallyJob = require('../models/TallyJob').default;
const { sendToTally } = require('./bridge');
const { alertWebhookUrl } = require('./config');

const FLUSH_INTERVAL_MS = 2000;
let flushing = false;

function backoffMs(retries) {
  return Math.min(1000 * 2 ** retries, 60_000);
}

async function enqueue({ type, xml, payload, refId }) {
  const job = await TallyJob.create({ type, xml, payload, refId });
  flush();
  return job;
}

async function flush() {
  if (flushing) return;
  flushing = true;

  try {
    const now = new Date();
    const jobs = await TallyJob.find({
      status: { $in: ['pending', 'retrying'] },
      $or: [
        { nextAttemptAt: { $exists: false } },
        { nextAttemptAt: { $lte: now } },
      ],
    }).sort({ createdAt: 1 });

    for (const job of jobs) {
      try {
        const response = await sendToTally(job.xml);
        await TallyJob.findByIdAndUpdate(job._id, {
          status: 'success',
          syncedAt: new Date(),
          lastError: null,
        });
        console.log(`[Queue] Job ${job._id} (${job.type}) synced OK`);
      } catch (err) {
        const retries = job.retries + 1;
        if (retries >= job.maxRetries) {
          await TallyJob.findByIdAndUpdate(job._id, {
            status: 'failed',
            retries,
            lastError: err.message,
          });
          console.error(`[Queue] Job ${job._id} (${job.type}) permanently failed: ${err.message}`);
          fireAlert(job, err.message);
        } else {
          const nextAttemptAt = new Date(Date.now() + backoffMs(retries));
          await TallyJob.findByIdAndUpdate(job._id, {
            status: 'retrying',
            retries,
            lastError: err.message,
            nextAttemptAt,
          });
          console.warn(`[Queue] Job ${job._id} retry ${retries}/${job.maxRetries} in ${backoffMs(retries) / 1000}s`);
        }
      }
    }
  } finally {
    flushing = false;
  }
}

async function resumeOnStartup() {
  // Wait for Mongoose to be connected before querying
  if (mongoose.connection.readyState !== 1) {
    await new Promise((resolve) => mongoose.connection.once('connected', resolve));
  }
  const count = await TallyJob.countDocuments({ status: { $in: ['pending', 'retrying'] } });
  if (count > 0) {
    console.log(`[Queue] Resuming ${count} pending Tally job(s) on startup`);
    setTimeout(flush, FLUSH_INTERVAL_MS);
  }
}

// Fix 8: POST to TALLY_ALERT_WEBHOOK_URL when a job permanently fails.
// Compatible with Slack, Discord, or any HTTP endpoint that accepts JSON.
function fireAlert(job, errorMsg) {
  if (!alertWebhookUrl) return;
  const body = JSON.stringify({
    text: `⚠️ Tally sync job permanently failed`,
    jobId: job._id,
    type: job.type,
    refId: job.refId,
    error: errorMsg,
    retries: job.retries,
    failedAt: new Date().toISOString(),
  });
  const mod = alertWebhookUrl.startsWith('https') ? https : http;
  try {
    const url = new URL(alertWebhookUrl);
    const req = mod.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    });
    req.on('error', () => {}); // fire-and-forget, never crash on alert failure
    req.write(body);
    req.end();
  } catch {}
}

module.exports = { enqueue, resumeOnStartup };
