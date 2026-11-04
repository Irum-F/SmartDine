import mongoose from 'mongoose';

const staffRequestSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    tableId: { type: mongoose.Schema.Types.ObjectId, ref: 'Table', required: true },
    tableNumber: { type: Number, required: true },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
  },
  { timestamps: true }
);

staffRequestSchema.index({ restaurantId: 1, status: 1 });

export const StaffRequest = mongoose.model('StaffRequest', staffRequestSchema);