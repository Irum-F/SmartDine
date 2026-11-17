import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    staffName: String, // copied, so the log still reads correctly if the account is renamed later
    action: { type: String, required: true },
    summary: { type: String, required: true },
    details: mongoose.Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

auditLogSchema.index({ restaurantId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 }); // MongoDB deletes entries after 1 year

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);