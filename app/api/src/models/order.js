import mongoose from 'mongoose';

export const ORDER_STATUSES = ['placed', 'cooking', 'ready', 'served', 'cancelled'];

const orderItemSchema = new mongoose.Schema(
  {
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    name: { type: String, required: true },          // snapshot at order time
    unitPriceMinor: { type: Number, required: true }, // snapshot at order time
    qty: { type: Number, required: true, min: 1, max: 50 },
    notes: { type: String, maxlength: 200, default: '' },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    tableId: { type: mongoose.Schema.Types.ObjectId, ref: 'Table', required: true },
    tableNumber: { type: Number, required: true },
    items: {
      type: [orderItemSchema],
      validate: { validator: (v) => v.length > 0, message: 'An order needs at least one item' },
    },
    totalMinor: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ORDER_STATUSES, default: 'placed' },
    placedBy: { type: String, enum: ['guest', 'staff'], default: 'guest' },
    guestPhone: { type: String },                     // only if the guest opts in to WhatsApp
    notifyConsent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

orderSchema.index({ restaurantId: 1, status: 1, createdAt: 1 });

export const Order = mongoose.model('Order', orderSchema);