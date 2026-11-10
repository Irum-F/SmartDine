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
    variants: { type: [variantSchema], default: [] },        // if set, the chosen variant's price replaces priceMinor
    modifierGroups: { type: [modifierGroupSchema], default: [] },
    imageKey: { type: String }, // S3 object key, added in week 4
    available: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const wholeNumber = { validator: Number.isInteger, message: '{PATH} must be a whole number' };

const variantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },              // e.g. "Large"
    priceMinor: { type: Number, required: true, min: 0, validate: wholeNumber },
  },
  { _id: false }
);

const modifierOptionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },              // e.g. "Extra cheese"
    priceDeltaMinor: { type: Number, default: 0, min: 0, validate: wholeNumber },
  },
  { _id: false }
);

const modifierGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },              // e.g. "Add-ons"
    minSelect: { type: Number, default: 0, min: 0 },                 // 1+ makes the group required
    maxSelect: { type: Number, default: 1, min: 1 },
    options: { type: [modifierOptionSchema], default: [] },
  },
  { _id: false }
);

menuItemSchema.index({ restaurantId: 1, category: 1, sortOrder: 1 });

export const MenuItem = mongoose.model('MenuItem', menuItemSchema);