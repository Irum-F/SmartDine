import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { Table } from '../models/table.js';
import { Restaurant } from '../models/restaurant.js';
import { MenuItem } from '../models/menuItem.js';
import { Order } from '../models/order.js';
import { TableSession } from '../models/tableSession.js';
import { StaffRequest } from '../models/staffRequest.js';
import { isOpenNow } from '../lib/hours.js';
import { createOrder, publicOrder } from '../services/orders.js';
import { objectId, idempotencyKey, orderBody, badRequest } from '../lib/validation.js';
import { randomUUID } from 'node:crypto';
import { emitOrder, emitRequest } from '../realtime/events.js';

const DEVICE_COOKIE = 'sd_device';

// One random id per phone, so only the phone that ordered can cancel
function deviceId(req, res) {
  let id = req.cookies?.[DEVICE_COOKIE];
  if (!/^[0-9a-f-]{36}$/.test(id ?? '')) {
    id = randomUUID();
    res.cookie(DEVICE_COOKIE, id, {
      httpOnly: true,
      sameSite: 'lax', // the QR scan arrives as a top-level navigation from the camera app
      secure: config.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000,
      path: '/api/t',
    });
  }
  return id;
}

export const guestRouter = Router();

// At most 20 orders per table every 10 minutes: stops flooding without bothering real guests
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.params.qrToken,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many orders from this table. Please ask a member of staff.', code: 'RATE_LIMITED' },
  skip: () => config.NODE_ENV === 'test',
});

async function loadTable(req, res, next) {
  const table = await Table.findOne({ qrToken: req.params.qrToken, active: true });
  if (!table) return res.status(404).json({ error: 'This table code is not valid', code: 'TABLE_NOT_FOUND' });
  req.table = table;
  req.restaurant = await Restaurant.findById(table.restaurantId);
  next();
}

const findOpenSession = (table) => TableSession.findOne({ tableId: table._id, status: 'open' });

// The menu, plus everything the guest's screen needs to decide what to show
guestRouter.get('/:qrToken', loadTable, async (req, res) => {
  const { restaurant, table } = req;
  const [session, items] = await Promise.all([
    findOpenSession(table),
    MenuItem.find({ restaurantId: restaurant._id }).sort({ category: 1, sortOrder: 1 }).lean(),
    deviceId(req, res),
  ]);

  res.json({
    restaurant: {
      name: restaurant.name,
      currency: restaurant.currency,
      locale: restaurant.locale,
      showVegSymbols: restaurant.showVegSymbols,
      busyMode: restaurant.busyMode,
      isOpen: isOpenNow(restaurant),
    },
    table: { number: table.number },
    sessionOpen: Boolean(session),
    menu: items.map((i) => ({
      id: i._id,
      name: i.name,
      description: i.description,
      category: i.category,
      priceMinor: i.priceMinor,
      dietary: i.dietary,
      variants: i.variants,
      modifierGroups: i.modifierGroups,
      available: i.available,
    })),
  });
});

guestRouter.post('/:qrToken/orders', orderLimiter, loadTable, async (req, res) => {
  const key = idempotencyKey.safeParse(req.get('Idempotency-Key'));
  if (!key.success) return badRequest(res, key.error.issues);
  if (!duplicate) emitOrder(order);

  const body = orderBody.required({ expectedTotalMinor: true }).safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues);

  const { restaurant, table } = req;
  if (!isOpenNow(restaurant)) {
    return res.status(403).json({ error: 'The restaurant is closed right now', code: 'CLOSED' });
  }
  if (restaurant.busyMode) {
    return res.status(503).json({
      error: 'The kitchen is very busy right now. Please ask a member of staff to order.',
      code: 'BUSY',
    });
  }

  const session = await findOpenSession(table);
  if (!session) {
    return res.status(403).json({
      error: 'This table isn\'t open yet. Please ask a member of staff.',
      code: 'TABLE_NOT_OPEN',
    });
  }

  const { order, duplicate } = await createOrder({
    restaurantId: restaurant._id,
    session,
    lines: body.data.items,
    idempotencyKey: key.data,
    expectedTotalMinor: body.data.expectedTotalMinor,
    guestPhone: body.data.guestPhone,
    notifyConsent: body.data.notifyConsent,
    deviceId: deviceId(req, res),
  });

  res.status(duplicate ? 200 : 201).json(publicOrder(order));
});

// This table's orders in the current session, for the live status screen
guestRouter.get('/:qrToken/orders', loadTable, async (req, res) => {
  const session = await findOpenSession(req.table);
  if (!session) return res.json([]);
  const orders = await Order.find({ sessionId: session._id }).sort({ createdAt: 1 });
  res.json(orders.map(publicOrder));
});

// Cancel only while the kitchen hasn't started, checked and updated in one atomic step
guestRouter.post('/:qrToken/orders/:orderId/cancel', loadTable, async (req, res) => {
  const id = objectId.safeParse(req.params.orderId);
  if (!id.success) return badRequest(res, id.error.issues);

  const session = await findOpenSession(req.table);
  if (!session) return res.status(403).json({ error: 'This table isn\'t open', code: 'TABLE_NOT_OPEN' });

  const device = req.cookies?.[DEVICE_COOKIE];
  const order = device
    ? await Order.findOneAndUpdate(
        { _id: id.data, sessionId: session._id, status: 'placed', deviceId: device },
        { status: 'cancelled' },
        { new: true }
      )
    : null;
  if (!order) {
    return res.status(409).json({
      error: 'Only the phone that placed this order can cancel it, before the kitchen starts. Please ask a member of staff.',
      code: 'CANNOT_CANCEL',
    });
  }
  emitOrder(order);
  res.json(publicOrder(order));
});

// "Call staff" and "Request bill". Pressing twice doesn't create two requests.
const requestBody = z.object({ type: z.enum(['help', 'bill']) });

guestRouter.post('/:qrToken/requests', loadTable, async (req, res) => {
  const body = requestBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues);

  const session = await findOpenSession(req.table);
  if (!session) return res.status(403).json({ error: 'This table isn\'t open', code: 'TABLE_NOT_OPEN' });

  const request = await StaffRequest.findOneAndUpdate(
    { sessionId: session._id, type: body.data.type, status: 'open' },
    {
      $setOnInsert: {
        restaurantId: session.restaurantId,
        tableId: session.tableId,
        tableNumber: session.tableNumber,
        sessionId: session._id,
        type: body.data.type,
      },
    },
    { upsert: true, new: true }
  );

// A table calling for staff is still active, so the idle sweeper must not close it
  await TableSession.updateOne({ _id: session._id }, { lastActivityAt: new Date() });

  // The waiters' screens show the alert instantly
  emitRequest(request);

  res.status(201).json({ id: request._id, type: request.type, status: request.status });
});