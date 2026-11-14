import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { Restaurant } from '../models/restaurant.js';
import { Staff } from '../models/staff.js';
import { hashPin, verifyPin } from '../lib/pin.js';
import { issueToken, COOKIE, cookieOptions } from '../lib/auth.js';
import { requireStaff } from '../middleware/requireStaff.js';
import { disconnectStaff } from '../realtime/events.js';

export const staffRouter = Router();

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const INVALID = { error: 'Invalid restaurant, username or PIN' };
const DUMMY_HASH = hashPin('000000'); // keeps response time the same for unknown users

const pinSchema = z.string().regex(/^\d{4,8}$/, 'PIN must be 4 to 8 digits');

const loginSchema = z.object({
  restaurantSlug: z.string().min(1).max(60),
  username: z.string().min(1).max(40),
  pin: pinSchema,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,                                  // per IP address
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
  skip: () => config.NODE_ENV === 'test',     // tests check the account lockout instead
});

staffRouter.post('/login', loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(INVALID);
  const { restaurantSlug, username, pin } = parsed.data;

  const restaurant = await Restaurant.findOne({ slug: restaurantSlug.toLowerCase() });
  const staff = restaurant
    ? await Staff.findOne({ restaurantId: restaurant._id, username: username.toLowerCase(), active: true })
    : null;

  if (!staff) {
    verifyPin(pin, DUMMY_HASH); // same work as a real check, so timing reveals nothing
    return res.status(401).json(INVALID);
  }

  if (staff.lockedUntil && staff.lockedUntil > new Date()) {
  // Same response and same timing as a wrong PIN, so a lock doesn't reveal the username exists
  await verifyPin(pin, DUMMY_HASH);
  return res.status(401).json(INVALID);
}

  if (!verifyPin(pin, staff.pinHash)) {
    staff.failedAttempts += 1;
    if (staff.failedAttempts >= MAX_ATTEMPTS) {
      staff.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
      staff.failedAttempts = 0;
      req.log.warn({ staffId: staff._id }, 'Staff account locked after repeated wrong PINs');
    }
    await staff.save();
    return res.status(401).json(INVALID);
  }

  staff.failedAttempts = 0;
  staff.lockedUntil = undefined;
  await staff.save();

  res.cookie(COOKIE, await issueToken(staff), cookieOptions);
  res.json({ name: staff.name, role: staff.role, mustChangePin: staff.mustChangePin });
});

staffRouter.post('/logout', requireStaff({ allowPinChange: true }), async (req, res) => {
  // ...your existing logic (e.g. bump tokenVersion)
  res.clearCookie('sd_staff', cookieOptions);
  disconnectStaff(req.staff._id);
  res.json({ ok: true });
});

staffRouter.get('/me', requireStaff({ allowPinChange: true }), (req, res) => {
  const { name, role, mustChangePin, restaurantId } = req.staff;
  res.json({ name, role, mustChangePin, restaurantId });
});

const WEAK_PINS = new Set(['1234', '12345', '123456', '4321', '654321', '1111', '0000']);

const changePinSchema = z
  .object({ currentPin: pinSchema, newPin: pinSchema })
  .refine((v) => v.newPin !== v.currentPin, { message: 'New PIN must be different' })
  .refine((v) => !WEAK_PINS.has(v.newPin) && !/^(\d)\1+$/.test(v.newPin), {
    message: 'That PIN is too easy to guess',
  });

staffRouter.post('/change-pin', requireStaff({ allowPinChange: true }), async (req, res) => {
  const parsed = changePinSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid PIN' });
  }

  const staff = req.staff;
  if (!verifyPin(parsed.data.currentPin, staff.pinHash)) {
    return res.status(401).json({ error: 'Current PIN is wrong' });
  }

  staff.pinHash = hashPin(newPin);
  staff.mustChangePin = false;
  staff.tokenVersion += 1;
  await staff.save();
  res.cookie('sd_staff', await issueToken(staff), cookieOptions);
  disconnectStaff(req.staff._id);

  res.json({ ok: true });
});