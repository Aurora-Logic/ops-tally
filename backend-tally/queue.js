const mongoose = require('mongoose');
const TallyJob = require('../models/TallyJob').default;
const { sendToTally } = require('./bridge');

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

module.exports = { enqueue, resumeOnStartup };
