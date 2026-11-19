import { Router } from 'express';
import { randomBytes, randomInt } from 'node:crypto';
import { z } from 'zod';
import { AuditLog } from '../models/auditLog.js';
import { MenuItem } from '../models/menuItem.js';
import { Restaurant } from '../models/restaurant.js';
import { Staff } from '../models/staff.js';
import { Table } from '../models/table.js';
import { TableSession } from '../models/tableSession.js';
import { requireStaff } from '../middleware/requireStaff.js';
import { hashPin } from '../lib/pin.js';
import { badRequest, objectId } from '../lib/validation.js';
import { audit } from '../services/audit.js';
import { publicMenuItem, sortMenu } from '../services/menu.js';
import { disconnectStaff, disconnectTable, emitConfigChanged } from '../realtime/events.js';
import { MAX_UPLOAD_BYTES, MediaError, createUpload, deleteKeys, finishUpload, photosEnabled } from '../services/media.js';

export const adminRouter = Router();
adminRouter.use(requireStaff({ roles: ['owner', 'manager'] })); // every route below is managers only

const notFound = (res, what) => res.status(404).json({ error: `${what} not found`, code: 'NOT_FOUND' });
const forbidden = (res, message) => res.status(403).json({ error: message, code: 'FORBIDDEN' });
const conflict = (res, message) => res.status(409).json({ error: message, code: 'CONFLICT' });
const rupees = (minor) => `₹${minor % 100 ? (minor / 100).toFixed(2) : minor / 100}`;

// Compare stored and new values while ignoring Mongo's _id fields and empty-vs-missing differences
const plain = (value, like) =>
  JSON.stringify(
    value ?? (typeof like === 'string' ? '' : Array.isArray(like) ? [] : null),
    (key, v) => (key === '_id' ? undefined : v)
  );
const changedKeys = (before, after) => Object.keys(after).filter((k) => plain(before[k], after[k]) !== plain(after[k], after[k]));

function idParam(req, res, key) {
  const id = objectId.safeParse(req.params[key]);
  if (!id.success) {
    badRequest(res, id.error.issues);
    return null;
  }
  return id.data;
}

/* ------------------------------ Menu ------------------------------ */

const label = (max) => z.string().trim().min(1).max(max);
const minor = z.number().int().min(0).max(10_000_000); // up to ₹1,00,000
const sameNames = (list) => new Set(list.map((x) => x.name.toLowerCase())).size !== list.length;

const itemBody = z
  .object({
    name: label(80),
    description: z.string().trim().max(300).default(''),
    category: label(40),
    priceMinor: minor,
    dietary: z.array(z.string().trim().min(1).max(30)).max(8).default([]),
    variants: z.array(z.object({ name: label(40), priceMinor: minor })).max(10).default([]),
    modifierGroups: z
      .array(
        z.object({
          name: label(40),
          minSelect: z.number().int().min(0).max(20),
          maxSelect: z.number().int().min(1).max(20),
          options: z.array(z.object({ name: label(40), priceDeltaMinor: minor })).min(1).max(30),
        })
      )
      .max(10)
      .default([]),
    available: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
  })
  .superRefine((item, ctx) => {
    if (sameNames(item.variants)) ctx.addIssue({ code: 'custom', path: ['variants'], message: 'Two sizes have the same name' });
    if (sameNames(item.modifierGroups)) ctx.addIssue({ code: 'custom', path: ['modifierGroups'], message: 'Two add-on groups have the same name' });
    item.modifierGroups.forEach((g, i) => {
      const path = ['modifierGroups', i];
      if (sameNames(g.options)) ctx.addIssue({ code: 'custom', path, message: `"${g.name}" has two options with the same name` });
      if (g.minSelect > g.maxSelect) ctx.addIssue({ code: 'custom', path, message: `"${g.name}": the minimum can't be more than the maximum` });
      if (g.maxSelect > g.options.length) ctx.addIssue({ code: 'custom', path, message: `"${g.name}": the maximum can't be more than the number of options` });
    });
  });

// With sizes, the item's own price is its cheapest size, so "from ₹…" is always right
const toDoc = (b) => ({ ...b, priceMinor: b.variants.length ? Math.min(...b.variants.map((v) => v.priceMinor)) : b.priceMinor });

adminRouter.get('/menu', async (req, res) => {
  const rid = req.staff.restaurantId;
  const [restaurant, items] = await Promise.all([Restaurant.findById(rid).lean(), MenuItem.find({ restaurantId: rid }).lean()]);
  res.json({
    categories: restaurant.categories ?? [],
    items: sortMenu(items, restaurant.categories).map((i) => ({ ...publicMenuItem(i), sortOrder: i.sortOrder ?? 0 })),
  });
});

adminRouter.post('/menu', async (req, res) => {
  const body = itemBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues);
  const item = await MenuItem.create({ ...toDoc(body.data), restaurantId: req.staff.restaurantId });
  await audit(req, 'menu.create', `Added "${item.name}" (${rupees(item.priceMinor)})`, { itemId: item._id });
  emitConfigChanged(req.staff.restaurantId);
  res.status(201).json({ ...publicMenuItem(item), sortOrder: item.sortOrder });
});

adminRouter.put('/menu/:itemId', async (req, res) => {
  const id = idParam(req, res, 'itemId');
  if (!id) return;
  const body = itemBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues);

  const filter = { _id: id, restaurantId: req.staff.restaurantId };
  const before = await MenuItem.findOne(filter).lean();
  if (!before) return notFound(res, 'Menu item');

  const doc = toDoc(body.data);
  const item = await MenuItem.findOneAndUpdate(filter, doc, { new: true, runValidators: true });
  const changed = changedKeys(before, doc);
  if (changed.length) {
    const summary =
      before.priceMinor !== item.priceMinor
        ? `Changed the price of "${item.name}" from ${rupees(before.priceMinor)} to ${rupees(item.priceMinor)}`
        : `Edited "${item.name}" (${changed.join(', ')})`;
    await audit(req, 'menu.update', summary, { itemId: item._id, changed });
    emitConfigChanged(req.staff.restaurantId);
  }
  res.json({ ...publicMenuItem(item), sortOrder: item.sortOrder });
});

// Past orders keep their own copy of names and prices, so deleting an item never changes old bills
adminRouter.delete('/menu/:itemId', async (req, res) => {
  const id = idParam(req, res, 'itemId');
  if (!id) return;
  const item = await MenuItem.findOneAndDelete({ _id: id, restaurantId: req.staff.restaurantId });
  if (!item) return notFound(res, 'Menu item');
  await deleteKeys(item.photo?.variants?.map((v) => v.key) ?? []).catch((err) => req.log.warn({ err }, 'Photo cleanup failed'));
  await audit(req, 'menu.delete', `Deleted "${item.name}"`, { itemId: item._id });
  emitConfigChanged(req.staff.restaurantId);
  res.json({ id: item._id, deleted: true });
});

/* ------------------------------ Photos ------------------------------ */

const uploadBody = z.object({ contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']) });
const photoBody = z.object({ key: z.string().min(10).max(300) });

function photosReady(res) {
  if (photosEnabled()) return true;
  res.status(503).json({ error: "Photos aren't set up on this server", code: 'PHOTOS_DISABLED' });
  return false;
}

// Step 1: the browser asks for permission to upload one photo
adminRouter.post('/menu/:itemId/photo-upload', async (req, res) => {
  if (!photosReady(res)) return;
  const id = idParam(req, res, 'itemId');
  if (!id) return;
  const body = uploadBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues);
  if (!(await MenuItem.exists({ _id: id, restaurantId: req.staff.restaurantId }))) return notFound(res, 'Menu item');

  const upload = await createUpload({ restaurantId: String(req.staff.restaurantId), itemId: id, contentType: body.data.contentType });
  res.json({ ...upload, maxBytes: MAX_UPLOAD_BYTES });
});

// Step 2: after uploading to S3, the browser asks the API to check, resize and attach it
adminRouter.post('/menu/:itemId/photo', async (req, res) => {
  if (!photosReady(res)) return;
  const id = idParam(req, res, 'itemId');
  if (!id) return;
  const body = photoBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues);

  const restaurantId = req.staff.restaurantId;
  const item = await MenuItem.findOne({ _id: id, restaurantId });
  if (!item) return notFound(res, 'Menu item');

  let variants;
  try {
    variants = await finishUpload({ key: body.data.key, restaurantId: String(restaurantId), itemId: id });
  } catch (err) {
    if (err instanceof MediaError) return res.status(400).json({ error: err.message, code: err.code });
    throw err;
  }

  const oldKeys = item.photo?.variants?.map((v) => v.key) ?? [];
  item.photo = { variants, updatedAt: new Date() };
  await item.save();
  // Uploading the same photo again produces the same names, so never delete what was just written
  await deleteKeys(oldKeys.filter((k) => !variants.some((v) => v.key === k))).catch((err) => req.log.warn({ err }, 'Old photo cleanup failed'));

  await audit(req, 'menu.photo', `Updated the photo of "${item.name}"`, { itemId: item._id });
  emitConfigChanged(restaurantId);
  res.json({ ...publicMenuItem(item), sortOrder: item.sortOrder });
});

adminRouter.delete('/menu/:itemId/photo', async (req, res) => {
  if (!photosReady(res)) return;
  const id = idParam(req, res, 'itemId');
  if (!id) return;
  const item = await MenuItem.findOne({ _id: id, restaurantId: req.staff.restaurantId });
  if (!item) return notFound(res, 'Menu item');

  const keys = item.photo?.variants?.map((v) => v.key) ?? [];
  item.photo = undefined;
  await item.save();
  await deleteKeys(keys).catch((err) => req.log.warn({ err }, 'Photo cleanup failed'));

  await audit(req, 'menu.photo', `Removed the photo of "${item.name}"`, { itemId: item._id });
  emitConfigChanged(req.staff.restaurantId);
  res.json({ ...publicMenuItem(item), sortOrder: item.sortOrder });
});

/* ------------------------------ Staff ------------------------------ */

const ROLES = ['owner', 'manager', 'waiter', 'kitchen'];
// Owners manage everyone; managers only waiters and kitchen staff
const MANAGEABLE = { owner: ROLES, manager: ['waiter', 'kitchen'] };
const canManage = (actor, role) => MANAGEABLE[actor.role]?.includes(role) ?? false;
const temporaryPin = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

const publicStaff = (s) => ({
  id: s._id,
  name: s.name,
  username: s.username,
  role: s.role,
  active: s.active,
  mustChangePin: s.mustChangePin,
  locked: Boolean(s.lockedUntil && s.lockedUntil > new Date()),
});

adminRouter.get('/staff', async (req, res) => {
  const list = await Staff.find({ restaurantId: req.staff.restaurantId }).sort({ name: 1 });
  list.sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
  res.json(list.map(publicStaff));
});

const newStaffBody = z.object({
  name: label(60),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,30}$/, '3–30 characters: letters, numbers, dot, dash or underscore'),
  role: z.enum(ROLES),
});

adminRouter.post('/staff', async (req, res) => {
  const body = newStaffBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues);
  if (!canManage(req.staff, body.data.role)) return forbidden(res, `You can't create ${body.data.role} accounts`);

  const restaurantId = req.staff.restaurantId;
  if (await Staff.exists({ restaurantId, username: body.data.username })) {
    return conflict(res, `The username "${body.data.username}" is already taken`);
  }

  const pin = temporaryPin();
  try {
    const member = await Staff.create({ ...body.data, restaurantId, pinHash: hashPin(pin), mustChangePin: true, active: true });
    await audit(req, 'staff.create', `Added ${member.role} ${member.name} (${member.username})`, { staffId: member._id });
    // The temporary PIN is returned once and never stored or logged in readable form
    res.status(201).json({ ...publicStaff(member), temporaryPin: pin });
  } catch (err) {
    if (err.code === 11000) return conflict(res, `The username "${body.data.username}" is already taken`);
    throw err;
  }
});

// Loads someone the signed-in person is allowed to change, or answers the request with why not
async function manageableTarget(req, res) {
  const id = idParam(req, res, 'staffId');
  if (!id) return null;
  const target = await Staff.findOne({ _id: id, restaurantId: req.staff.restaurantId });
  if (!target) {
    notFound(res, 'Staff member');
    return null;
  }
  if (String(target._id) === String(req.staff._id)) {
    forbidden(res, "You can't change your own account here. Use Change PIN, or ask another owner.");
    return null;
  }
  if (!canManage(req.staff, target.role)) {
    forbidden(res, `You can't change ${target.role} accounts`);
    return null;
  }
  return target;
}

const updateStaffBody = z
  .object({ role: z.enum(ROLES).optional(), active: z.boolean().optional() })
  .refine((b) => b.role !== undefined || b.active !== undefined, 'Nothing to change');

adminRouter.patch('/staff/:staffId', async (req, res) => {
  const body = updateStaffBody.safeParse(req.body ?? {});
  if (!body.success) return badRequest(res, body.error.issues);
  const target = await manageableTarget(req, res);
  if (!target) return;
  if (body.data.role && !canManage(req.staff, body.data.role)) return forbidden(res, `You can't give someone the ${body.data.role} role`);

  const notes = [];
  if (body.data.role && body.data.role !== target.role) {
    notes.push(`role ${target.role} → ${body.data.role}`);
    target.role = body.data.role;
  }
  if (body.data.active !== undefined && body.data.active !== target.active) {
    notes.push(body.data.active ? 'reactivated' : 'deactivated');
    target.active = body.data.active;
  }
  if (notes.length) {
    target.tokenVersion += 1; // sign out everywhere so the change applies at once
    await target.save();
    disconnectStaff(target._id);
    await audit(req, 'staff.update', `${target.name}: ${notes.join(', ')}`, { staffId: target._id });
  }
  res.json(publicStaff(target));
});

adminRouter.post('/staff/:staffId/reset-pin', async (req, res) => {
  const target = await manageableTarget(req, res);
  if (!target) return;
  const pin = temporaryPin();
  target.pinHash = hashPin(pin);
  target.mustChangePin = true;
  target.failedAttempts = 0; // also unlocks a locked account
  target.lockedUntil = undefined;
  target.tokenVersion += 1;
  await target.save();
  disconnectStaff(target._id);
  await audit(req, 'staff.reset-pin', `Reset the PIN for ${target.name}`, { staffId: target._id });
  res.json({ ...publicStaff(target), temporaryPin: pin });
});

/* ------------------------------ Tables ------------------------------ */

adminRouter.get('/tables', async (req, res) => {
  const rid = req.staff.restaurantId;
  const [tables, open] = await Promise.all([
    Table.find({ restaurantId: rid }).sort({ number: 1 }),
    TableSession.find({ restaurantId: rid, status: 'open' }, 'tableId'),
  ]);
  const openIds = new Set(open.map((s) => String(s.tableId)));
  res.json(tables.map((t) => ({ id: t._id, number: t.number, active: t.active, open: openIds.has(String(t._id)) })));
});

const newTableBody = z.object({ number: z.number().int().min(1).max(999) });

adminRouter.post('/tables', async (req, res) => {
  const body = newTableBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues);
  try {
    const table = await Table.create({
      restaurantId: req.staff.restaurantId,
      number: body.data.number,
      qrToken: randomBytes(18).toString('base64url'),
      active: true,
    });
    await audit(req, 'table.create', `Added table ${table.number}`);
    emitConfigChanged(req.staff.restaurantId);
    res.status(201).json({ id: table._id, number: table.number, active: true, open: false });
  } catch (err) {
    if (err.code === 11000) return conflict(res, `Table ${body.data.number} already exists. If it was removed, bring it back instead.`);
    throw err;
  }
});

const updateTableBody = z.object({ active: z.boolean() });

adminRouter.patch('/tables/:tableId', async (req, res) => {
  const id = idParam(req, res, 'tableId');
  if (!id) return;
  const body = updateTableBody.safeParse(req.body ?? {});
  if (!body.success) return badRequest(res, body.error.issues);

  const table = await Table.findOne({ _id: id, restaurantId: req.staff.restaurantId });
  if (!table) return notFound(res, 'Table');
  if (!body.data.active && (await TableSession.exists({ tableId: table._id, status: 'open' }))) {
    return conflict(res, `Table ${table.number} has guests. Close it before removing it.`);
  }

  table.active = body.data.active;
  await table.save();
  if (!table.active) disconnectTable(table._id);
  await audit(req, 'table.update', `${table.active ? 'Brought back' : 'Removed'} table ${table.number}`);
  emitConfigChanged(req.staff.restaurantId);
  res.json({ id: table._id, number: table.number, active: table.active, open: false });
});

/* ------------------------------ Settings ------------------------------ */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time, like 09:30');
const settingsBody = z.object({
  name: label(80),
  showVegSymbols: z.boolean(),
  openingHours: z
    .array(
      z
        .object({ day: z.number().int().min(0).max(6), open: hhmm, close: hhmm })
        .refine((h) => h.open !== h.close, "Opening and closing time can't be the same")
    )
    .max(28),
  categories: z
    .array(label(40))
    .max(30)
    .refine((list) => new Set(list.map((c) => c.toLowerCase())).size === list.length, 'A category is listed twice'),
});

adminRouter.get('/settings', async (req, res) => {
  const rid = req.staff.restaurantId;
  const [r, inUse] = await Promise.all([Restaurant.findById(rid).lean(), MenuItem.distinct('category', { restaurantId: rid })]);
  res.json({
    name: r.name,
    showVegSymbols: r.showVegSymbols,
    openingHours: r.openingHours ?? [],
    categories: r.categories ?? [],
    categoriesInUse: inUse.filter(Boolean).sort(),
  });
});

adminRouter.put('/settings', async (req, res) => {
  const body = settingsBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.issues);
  const rid = req.staff.restaurantId;
  const before = await Restaurant.findById(rid).lean();
  const r = await Restaurant.findByIdAndUpdate(rid, body.data, { new: true, runValidators: true });
  const changed = changedKeys(before, body.data);
  if (changed.length) {
    await audit(req, 'settings.update', `Updated settings (${changed.join(', ')})`, { changed });
    emitConfigChanged(rid);
  }
  res.json({ name: r.name, showVegSymbols: r.showVegSymbols, openingHours: r.openingHours, categories: r.categories });
});

/* ------------------------------ Activity log ------------------------------ */

const auditQuery = z.object({
  before: z.string().datetime().optional(), // for "Load older"
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

adminRouter.get('/audit', async (req, res) => {
  const q = auditQuery.safeParse(req.query);
  if (!q.success) return badRequest(res, q.error.issues);
  const filter = { restaurantId: req.staff.restaurantId };
  if (q.data.before) filter.createdAt = { $lt: new Date(q.data.before) };
  const entries = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(q.data.limit).lean();
  res.json(entries.map((e) => ({ id: e._id, at: e.createdAt, staffName: e.staffName, action: e.action, summary: e.summary })));
});