import mongoose from 'mongoose';

export const DIETARY_TAGS = ['veg', 'vegan', 'gluten-free', 'contains-nuts', 'spicy'];

const wholeNumber = { validator: Number.isInteger, message: '{PATH} must be a whole number' };

const variantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    priceMinor: { type: Number, required: true, min: 0, validate: wholeNumber },
  },
  { _id: false }
);

const modifierOptionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    priceDeltaMinor: { type: Number, default: 0, min: 0, validate: wholeNumber },
  },
  { _id: false }
);

const modifierGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    minSelect: { type: Number, default: 0, min: 0 },
    maxSelect: { type: Number, default: 1, min: 1 },
    options: { type: [modifierOptionSchema], default: [] },
  },
  { _id: false }
);

const menuItemSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', maxlength: 300 },
    priceMinor: { type: Number, required: true, min: 0, validate: wholeNumber },
    category: { type: String, required: true, trim: true },
    dietary: [{ type: String, enum: DIETARY_TAGS }],
    variants: { type: [variantSchema], default: [] },
    modifierGroups: { type: [modifierGroupSchema], default: [] },
    imageKey: { type: String },
    available: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

menuItemSchema.index({ restaurantId: 1, category: 1, sortOrder: 1 });

export const MenuItem = mongoose.model('MenuItem', menuItemSchema);