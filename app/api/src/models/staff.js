import mongoose from 'mongoose';

export const ROLES = ['owner', 'manager', 'waiter', 'kitchen'];

const staffSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    name: { type: String, required: true, trim: true },
    username: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9._-]{2,40}$/, 'Username may only contain letters, numbers, dots, dashes and underscores'],
    },
    role: { type: String, enum: ROLES, required: true },
    pinHash: { type: String, required: true },
    active: { type: Boolean, default: true },
    mustChangePin: { type: Boolean, default: true },
    failedAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    tokenVersion: { type: Number, default: 0 }, // bumped on PIN change to sign out old sessions
  },
  { timestamps: true }
);

staffSchema.index({ restaurantId: 1, username: 1 }, { unique: true });

export const Staff = mongoose.model('Staff', staffSchema);