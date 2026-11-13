import { z } from 'zod';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

// Generated on the phone (crypto.randomUUID()) and sent in the Idempotency-Key header
export const idempotencyKey = z.string().min(16).max(100).regex(/^[A-Za-z0-9-]+$/);

export const orderBody = z.object({
  items: z
    .array(
      z.object({
        menuItemId: objectId,
        variantName: z.string().max(60).optional(),
        modifiers: z.array(z.object({ group: z.string().max(60), option: z.string().max(60) })).max(20).optional(),
        qty: z.number().int().min(1).max(50),
        notes: z.string().max(200).optional(),
      })
    )
    .min(1)
    .max(30),
  expectedTotalMinor: z.number().int().min(0).optional(),
  guestPhone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use international format, e.g. +919876543210').optional(),
  notifyConsent: z.boolean().optional(),
});

export function badRequest(res, issues) {
  return res.status(400).json({ error: 'Invalid request', code: 'BAD_REQUEST', details: issues });
}