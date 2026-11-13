import { Router } from 'express';
import { z } from 'zod';
import { Table } from '../models/table.js';
import { TableSession } from '../models/tableSession.js';
import { MenuItem } from '../models/menuItem.js';
import { Restaurant } from '../models/restaurant.js';
import { StaffRequest } from '../models/staffRequest.js';
import { requireStaff } from '../middleware/requireStaff.js';
import { createOrder, publicOrder } from '../services/orders.js';
import { objectId, idempotencyKey, orderBody, badRequest } from '../lib/validation.js';

export const opsRouter = Router();

const FLOOR = ['owner', 'manager', 'waiter'];
const MENU_AVAILABILITY = ['owner', 'manager', 'kitchen'];
const MANAGERS = ['owner', 'manager'];

// Every table with its current session, for the waiter's floor screen
opsRouter.get('/tables', requireStaff({ roles: FLOOR }), async (req, res) => {
  const restaurantId = req.staff.restaurantId;
  const [tables, sessions] = await Promise.all([
    Table.find({ restaurantId, active: true }).sort({ number: 1 }),
    TableSession.find({ restaurantId, status: 'open' }),
  ]);
  const byTable = new Map(sessions.map((s) => [String(s.tableId), s]));
  res.json(
    tables.map((t) => {
      const s = byTable.get(String(t._id));
      return { id: t._id, number: t.number, session: s ? { id: s._id, openedAt: s.createdAt } : null };
    })
  );
});

opsRouter.post('/tables/:tableId/open', requireStaff({ roles: FLOOR }), async (req, res) => {
  const id = objectId.safeParse(req.params.tableId);
  if (!id.success) return badRequest(res, id.error.issues);

  const table = await Table.findOne({ _id: id.data, restaurantId: req.staff.restaurantId, active: true });
  if (!table) return res.status(404).json({ error: 'Table not found', code: 'NOT_FOUND' });

  try {
    const session = await TableSession.create({
      restaurantId: table.restaurantId,
      tableId: table._id,
      tableNumber: table.number,
      openedBy: req.staff._id,
    });
    res.status(201).json({ id: session._id, tableNumber: session.tableNumber });
  } catch (err) {
    // The unique index allows only one open session per table
    if (err.code === 11000) {
      return res.status(409).json({ error: 'This table is already open', code: 'TABLE_ALREADY_OPEN' });
    }
    throw err;
  }
});

opsRouter.post('/sessions/:sessionId/close', requireStaff({ roles: FLOOR }), async (req, res) => {
  const id = objectId.safeParse(req.params.sessionId);
  if (!id.success) return badRequest(res, id.error.issues);

  const session = await TableSession.findOneAndUpdate(
    { _id: id.data, restaurantId: req.staff.restaurantId, status: 'open' },
    { status: 'closed', closedAt: new Date() },
    { new: true }
  );
  if (!session) return res.status(404).json({ error: 'Open session not found', code: 'NOT_FOUND' });

  await StaffRequest.updateMany({ sessionId: session._id, status: 'open' }, { status: 'resolved' });
  res.json({ id: session._id, status: session.status });
});

// Staff mode: a waiter orders for guests who can't or won't use their phone to order by themselves (old people, uncomfortable with tech, etc)
opsRouter.post('/sessions/:sessionId/orders', requireStaff({ roles: FLOOR }), async (req, res) => {
  const id = objectId.safeParse(req.params.sessionId);
  if (!id.success) return badRequest(res, id.error.issues);
  const key = idempotencyKey.safeParse(req.get('Idempotency-Key'));
  if (!key.success) return badRequest(res, key.error.issues);
  const body = orderBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues);

  const session = await TableSession.findOne({ _id: id.data, restaurantId: req.staff.restaurantId, status: 'open' });
  if (!session) return res.status(404).json({ error: 'Open session not found', code: 'NOT_FOUND' });

  const { order, duplicate } = await createOrder({
    restaurantId: session.restaurantId,
    session,
    lines: body.data.items,
    idempotencyKey: key.data,
    expectedTotalMinor: body.data.expectedTotalMinor,
    placedBy: 'staff',
    staffId: req.staff._id,
  });
  res.status(duplicate ? 200 : 201).json(publicOrder(order));
});

// Mark an item sold out, or back in stock
const availabilityBody = z.object({ available: z.boolean() });

opsRouter.patch('/menu-items/:itemId/availability', requireStaff({ roles: MENU_AVAILABILITY }), async (req, res) => {
  const id = objectId.safeParse(req.params.itemId);
  if (!id.success) return badRequest(res, id.error.issues);
  const body = availabilityBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues);

  const item = await MenuItem.findOneAndUpdate(
    { _id: id.data, restaurantId: req.staff.restaurantId },
    { available: body.data.available },
    { new: true }
  );
  if (!item) return res.status(404).json({ error: 'Menu item not found', code: 'NOT_FOUND' });
  res.json({ id: item._id, available: item.available });
});

// Busy mode: pauses QR ordering when the kitchen is overwhelmed
const busyBody = z.object({ busyMode: z.boolean() });

opsRouter.patch('/restaurant/busy-mode', requireStaff({ roles: MANAGERS }), async (req, res) => {
  const body = busyBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues);
  const restaurant = await Restaurant.findByIdAndUpdate(
    req.staff.restaurantId,
    { busyMode: body.data.busyMode },
    { new: true }
  );
  res.json({ busyMode: restaurant.busyMode });
});