import mongoose, { Schema, Document } from 'mongoose';

export interface ITallyJob extends Document {
  type: 'salesOrder' | 'invoice' | 'customer' | 'dispatch';
  payload: Record<string, unknown>;
  xml: string;
  status: 'pending' | 'success' | 'failed' | 'retrying';
  retries: number;
  maxRetries: number;
  lastError?: string;
  refId?: string;
  nextAttemptAt?: Date;
  syncedAt?: Date;
  createdAt: Date;
}

const TallyJobSchema = new Schema<ITallyJob>({
  type: {
    type: String,
    enum: ['salesOrder', 'invoice', 'customer', 'dispatch'],
    required: true,
  },
  payload: { type: Schema.Types.Mixed, required: true },
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

const TallyJob = mongoose.models.TallyJob || mongoose.model<ITallyJob>('TallyJob', TallyJobSchema);
export default TallyJob;
