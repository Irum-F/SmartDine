import mongoose from 'mongoose';

const restaurantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    currency: { type: String, default: 'INR' },
    locale: { type: String, default: 'en-IN' },            // number and price formatting
    timezone: { type: String, default: 'Asia/Kolkata' },   // times stored in UTC, shown in this zone
    showVegSymbols: { type: Boolean, default: true },      // green/red veg and non-veg markers
    busyMode: { type: Boolean, default: false },           // pauses QR ordering when the kitchen is overwhelmed
  },
  { timestamps: true }
);

export const Restaurant = mongoose.model('Restaurant', restaurantSchema);