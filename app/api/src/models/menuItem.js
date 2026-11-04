import mongoose from 'mongoose';

export const DIETARY_TAGS = ['veg', 'vegan', 'gluten-free', 'contains-nuts', 'spicy'];

const menuItemSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', maxlength: 300 },
    priceMinor: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: 'priceMinor must be a whole number' },
    },
    category: { type: String, required: true, trim: true },
    dietary: [{ type: String, enum: DIETARY_TAGS }],
    imageKey: { type: String }, // S3 object key, added in week 4
    available: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

menuItemSchema.index({ restaurantId: 1, category: 1, sortOrder: 1 });

export const MenuItem = mongoose.model('MenuItem', menuItemSchema);