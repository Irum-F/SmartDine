import mongoose from 'mongoose';

const restaurantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    currency: { type: String, default: 'INR' },
    locale: { type: String, default: 'en-IN' },            // number and price formatting
    timezone: { type: String, default: 'Asia/Kolkata' },   // times stored in UTC, shown in this zone
    showVegSymbols: { type: Boolean, default: true },      // green/red veg and non-veg markers
    busyMode: { type: Boolean, default: false }, 
    // Empty = always open. Overnight hours work too, e.g. { day: 5, open: '18:00', close: '02:00' }
    openingHours: [
      {
        _id: false,
        day: { type: Number, min: 0, max: 6, required: true }, // 0 = Sunday
        open: { type: String, match: /^\d{2}:\d{2}$/, required: true },
        close: { type: String, match: /^\d{2}:\d{2}$/, required: true },
      },
    ],          // pauses QR ordering when the kitchen is overwhelmed
  },
  { timestamps: true }
);

export const Restaurant = mongoose.model('Restaurant', restaurantSchema);