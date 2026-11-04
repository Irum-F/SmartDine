import mongoose from 'mongoose';

const tableSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    number: { type: Number, required: true },
    qrToken: { type: String, required: true, unique: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

tableSchema.index({ restaurantId: 1, number: 1 }, { unique: true });

export const Table = mongoose.model('Table', tableSchema);