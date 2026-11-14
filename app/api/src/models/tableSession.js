import mongoose from 'mongoose';

const tableSessionSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    tableId: { type: mongoose.Schema.Types.ObjectId, ref: 'Table', required: true },
    tableNumber: { type: Number, required: true },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    openedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
    closedAt: { type: Date },
    lastActivityAt: { type: Date, default: Date.now }, // to auto-close forgotten tables
    closedAt: Date,
    closedReason: { type: String, enum: ['staff', 'idle'] },
    openedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  },
  { timestamps: true }
);

tableSessionSchema.index(
  { tableId: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } }
);
tableSessionSchema.index({ restaurantId: 1, status: 1 });

export const TableSession = mongoose.model('TableSession', tableSessionSchema);