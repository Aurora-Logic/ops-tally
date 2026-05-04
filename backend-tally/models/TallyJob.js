const mongoose = require('mongoose');

const TallyJobSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['salesOrder', 'invoice', 'customer', 'dispatch', 'cancellation', 'product'],
    required: true,
  },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  xml: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'success', 'failed', 'retrying'],
    default: 'pending',
  },
  retries: { type: Number, default: 0 },
  maxRetries: { type: Number, default: 5 },
  lastError: String,
  refId: String,
  nextAttemptAt: Date,
  syncedAt: Date,
  createdAt: { type: Date, default: Date.now },
});

TallyJobSchema.index({ status: 1, createdAt: 1 });
TallyJobSchema.index({ refId: 1 });

const TallyJob = mongoose.models.TallyJob || mongoose.model('TallyJob', TallyJobSchema);

module.exports = {
  default: TallyJob,
  TallyJob
};
