import { Order } from '../models/order.js';
import { closeSession } from '../services/sessions.js';
import { emitOrder, emitRequest, emitAvailability, emitBusy, emitSessionOpened, disconnectTable } from '../realtime/events.js';
import { Router } from 'express';
import { randomInt } from 'node:crypto';
import { hashPin } from '../lib/pin.js';
import { z } from 'zod';
import { Staff } from '../models/staff.js';
import { Table } from '../models/table.js';
import { TableSession } from '../models/tableSession.js';
import { MenuItem } from '../models/menuItem.js';
import { Restaurant } from '../models/restaurant.js';
import { StaffRequest } from '../models/staffRequest.js';
import { requireStaff } from '../middleware/requireStaff.js';
import { createOrder, publicOrder } from '../services/orders.js';
import { objectId, idempotencyKey, orderBody, badRequest } from '../lib/validation.js';
import { randomBytes } from 'node:crypto';
import { publicMenuItem } from '../services/menu.js';

export const opsRouter = Router();

const FLOOR = ['owner', 'manager', 'waiter'];
const MENU_AVAILABILITY = ['owner', 'manager', 'kitchen'];
const MANAGERS = ['owner', 'manager'];
const KITCHEN = ['owner', 'manager', 'kitchen'];
const ALL_STAFF = ['owner', 'manager', 'waiter', 'kitchen'];

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
    emitSessionOpened(session);
    res.status(201).json({ id: session._id, tableNumber: session.tableNumber });
  } catch (err) {
    // The unique index allows only one open session per table
    if (err.code === 11000) {
      return res.status(409).json({ error: 'This table is already open', code: 'TABLE_ALREADY_OPEN' });
    }
    throw err;
  }
});

// Staff mode: a waiter orders for guests who can't or won't use their phone to order by themselves (old people, uncomfortable with tech, etc)
const closeBody = z.object({ force: z.boolean().optional() });

opsRouter.post('/sessions/:sessionId/close', requireStaff({ roles: FLOOR }), async (req, res) => {
  const id = objectId.safeParse(req.params.sessionId);
  if (!id.success) return badRequest(res, id.error.issues);
  const body = closeBody.safeParse(req.body ?? {}); // Express 5 leaves req.body undefined when nothing is sent
  if (!body.success) return badRequest(res, body.error.issues);

  const { session, unfinished } = await closeSession(
    { _id: id.data, restaurantId: req.staff.restaurantId },
    'staff',
    { force: body.data.force }
  );
  if (unfinished) {
    return res.status(409).json({
      error: `${unfinished} order(s) are still being prepared`,
      code: 'HAS_UNFINISHED_ORDERS',
      details: { unfinished },
    });
  }
  if (!session) return res.status(404).json({ error: 'Open session not found', code: 'NOT_FOUND' });
  res.json({ id: session._id, status: session.status });
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
  emitAvailability(item);
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
  emitBusy(restaurant);
  res.json({ busyMode: restaurant.busyMode });
});

// Staff list for managers, showing who is locked out
opsRouter.get('/staff', requireStaff({ roles: MANAGERS }), async (req, res) => {
  const staff = await Staff.find({ restaurantId: req.staff.restaurantId }).sort({ role: 1, username: 1 });
  const now = new Date();
  res.json(
    staff.map((s) => ({
      id: s._id,
      name: s.name,
      username: s.username,
      role: s.role,
      active: s.active,
      locked: Boolean(s.lockedUntil && s.lockedUntil > now),
    }))
  );
});

// Unlock instantly. Managers can't unlock owners, only an owner can.
opsRouter.post('/staff/:staffId/unlock', requireStaff({ roles: MANAGERS }), async (req, res) => {
  const id = objectId.safeParse(req.params.staffId);
  if (!id.success) return badRequest(res, id.error.issues);

  const target = await Staff.findOne({ _id: id.data, restaurantId: req.staff.restaurantId });
  if (!target || (target.role === 'owner' && req.staff.role !== 'owner')) {
    return res.status(404).json({ error: 'Staff member not found', code: 'NOT_FOUND' });
  }

  await Staff.updateOne({ _id: target._id }, { $set: { failedAttempts: 0, lockedUntil: null } });
  req.log.info({ staffId: target._id, unlockedBy: req.staff._id }, 'Staff account unlocked');
  res.json({ id: target._id, locked: false });
});

// A staff member forgot their PIN: a manager gives them a new temporary one on the spot. The temporary PIN is shown once to the manager, who tells it to the staff member
opsRouter.post('/staff/:staffId/reset-pin', requireStaff({ roles: MANAGERS }), async (req, res) => {
  const id = objectId.safeParse(req.params.staffId);
  if (!id.success) return badRequest(res, id.error.issues);

  if (id.data === String(req.staff._id)) {
    return res.status(400).json({ error: 'Use change PIN for your own account', code: 'SELF_RESET' });
  }

  const target = await Staff.findOne({ _id: id.data, restaurantId: req.staff.restaurantId });
  if (!target || (target.role === 'owner' && req.staff.role !== 'owner')) {
    return res.status(404).json({ error: 'Staff member not found', code: 'NOT_FOUND' });
  }

  const tempPin = String(randomInt(100000, 1000000));
  await Staff.updateOne(
    { _id: target._id },
    {
      $set: { pinHash: await hashPin(tempPin), mustChangePin: true, failedAttempts: 0, lockedUntil: null },
      $inc: { tokenVersion: 1 }, // signs out every device using the old PIN
    }
  );

  req.log.info({ staffId: target._id, resetBy: req.staff._id }, 'Staff PIN reset'); // never the PIN itself
  res.set('Cache-Control', 'no-store');
  res.json({ id: target._id, username: target.username, temporaryPin: tempPin });
});

// Snapshot for kitchen and floor screens: loaded on every (re)connect, then kept fresh by events
opsRouter.get('/kitchen/orders', requireStaff({ roles: ALL_STAFF }), async (req, res) => {
  const orders = await Order.find({ restaurantId: req.staff.restaurantId, status: { $in: ['placed', 'cooking', 'ready'] } })
    .sort({ createdAt: 1 })
    .limit(500);
  res.json({ serverTime: new Date(), orders: orders.map(publicOrder) });
});

// Which role may move an order to which status, and from where
const TRANSITIONS = {
  cooking: { from: ['placed'], roles: KITCHEN },
  ready: { from: ['cooking'], roles: KITCHEN },
  served: { from: ['ready'], roles: FLOOR },
  cancelled: { from: ['placed', 'cooking'], roles: MANAGERS },
};
const statusBody = z.object({ status: z.enum(Object.keys(TRANSITIONS)) });

opsRouter.patch('/orders/:orderId/status', requireStaff({ roles: ALL_STAFF }), async (req, res) => {
  const id = objectId.safeParse(req.params.orderId);
  if (!id.success) return badRequest(res, id.error.issues);
  const body = statusBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues);

  const rule = TRANSITIONS[body.data.status];
  if (!rule.roles.includes(req.staff.role)) {
    return res.status(403).json({ error: "Your role can't make this change", code: 'FORBIDDEN' });
  }

  // Two kitchen tablets tapping at once: the status condition lets exactly one succeed
  const order = await Order.findOneAndUpdate(
    { _id: id.data, restaurantId: req.staff.restaurantId, status: { $in: rule.from } },
    { status: body.data.status },
    { new: true }
  );
  if (!order) {
    const current = await Order.findOne({ _id: id.data, restaurantId: req.staff.restaurantId }, 'status');
    if (!current) return res.status(404).json({ error: 'Order not found', code: 'NOT_FOUND' });
    return res.status(409).json({ error: `This order is already ${current.status}`, code: 'INVALID_TRANSITION', details: { status: current.status } });
  }
  emitOrder(order);
  res.json(publicOrder(order));
});

opsRouter.get('/requests', requireStaff({ roles: FLOOR }), async (req, res) => {
  const list = await StaffRequest.find({ restaurantId: req.staff.restaurantId, status: 'open' }).sort({ createdAt: 1 });
  res.json({
    serverTime: new Date(),
    requests: list.map((r) => ({
      id: r._id, type: r.type, tableNumber: r.tableNumber, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt,
    })),
  });
});

opsRouter.post('/requests/:requestId/resolve', requireStaff({ roles: FLOOR }), async (req, res) => {
  const id = objectId.safeParse(req.params.requestId);
  if (!id.success) return badRequest(res, id.error.issues);
  const request = await StaffRequest.findOneAndUpdate(
    { _id: id.data, restaurantId: req.staff.restaurantId, status: 'open' },
    { status: 'resolved' },
    { new: true }
  );
  if (!request) return res.status(404).json({ error: 'Open request not found', code: 'NOT_FOUND' });
  emitRequest(request);
  res.json({ id: request._id, status: request.status });
});

// Full menu for staff screens: sold-out switches and staff-mode ordering
opsRouter.get('/menu', requireStaff({ roles: ALL_STAFF }), async (req, res) => {
  const items = await MenuItem.find({ restaurantId: req.staff.restaurantId }).sort({ category: 1, sortOrder: 1 }).lean();
  res.json(items.map(publicMenuItem));
});

// Everything a table ordered in one session, with the running bill
opsRouter.get('/sessions/:sessionId/orders', requireStaff({ roles: FLOOR }), async (req, res) => {
  const id = objectId.safeParse(req.params.sessionId);
  if (!id.success) return badRequest(res, id.error.issues);
  const session = await TableSession.findOne({ _id: id.data, restaurantId: req.staff.restaurantId });
  if (!session) return res.status(404).json({ error: 'Session not found', code: 'NOT_FOUND' });

  const orders = await Order.find({ sessionId: session._id }).sort({ createdAt: 1 });
  const billMinor = orders.filter((o) => o.status !== 'cancelled').reduce((sum, o) => sum + o.totalMinor, 0);
  res.json({
    session: { id: session._id, tableNumber: session.tableNumber, status: session.status, openedAt: session.createdAt },
    billMinor,
    orders: orders.map(publicOrder),
  });
});

// QR tokens are secrets (anyone holding one can see that table's orders), so managers only
opsRouter.get('/tables/qr', requireStaff({ roles: MANAGERS }), async (req, res) => {
  const tables = await Table.find({ restaurantId: req.staff.restaurantId, active: true }).sort({ number: 1 });
  res.json(tables.map((t) => ({ id: t._id, number: t.number, qrToken: t.qrToken })));
});

// A card was stolen or photographed: give the table a new code. The old one stops working at once.
opsRouter.post('/tables/:tableId/rotate-qr', requireStaff({ roles: MANAGERS }), async (req, res) => {
  const id = objectId.safeParse(req.params.tableId);
  if (!id.success) return badRequest(res, id.error.issues);
  const table = await Table.findOne({ _id: id.data, restaurantId: req.staff.restaurantId, active: true });
  if (!table) return res.status(404).json({ error: 'Table not found', code: 'NOT_FOUND' });

  // Never while guests are seated: their phones would stop working mid-meal
  if (await TableSession.exists({ tableId: table._id, status: 'open' })) {
    return res.status(409).json({ error: 'Close the table before replacing its QR code', code: 'TABLE_OPEN' });
  }

  table.qrToken = randomBytes(18).toString('base64url');
  await table.save();
  disconnectTable(table._id);
  res.json({ id: table._id, number: table.number, qrToken: table.qrToken });
});