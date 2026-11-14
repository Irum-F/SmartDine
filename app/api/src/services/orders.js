import { MenuItem } from '../models/menuItem.js';
import { Order } from '../models/order.js';
import { TableSession } from '../models/tableSession.js';

export class OrderError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// Works out every line's price from the database. Nothing the phone sends is trusted.
export async function priceOrder(restaurantId, lines) {
  const ids = [...new Set(lines.map((l) => l.menuItemId))];
  const items = await MenuItem.find({ _id: { $in: ids }, restaurantId });
  const byId = new Map(items.map((i) => [String(i._id), i]));

  const unavailable = ids.filter((id) => !byId.get(id)?.available);
  if (unavailable.length) {
    throw new OrderError('ITEM_UNAVAILABLE', 'Some items are no longer available', 409, {
      menuItemIds: unavailable,
    });
  }

  const priced = lines.map((line) => {
    const item = byId.get(line.menuItemId);

    // Size: used only when the item has sizes
    let basePrice = item.priceMinor;
    let variantName;
    if (item.variants.length) {
      const variant = item.variants.find((v) => v.name === line.variantName);
      if (!variant) throw new OrderError('INVALID_OPTION', `Please choose a size for ${item.name}`);
      basePrice = variant.priceMinor;
      variantName = variant.name;
    } else if (line.variantName) {
      throw new OrderError('INVALID_OPTION', `${item.name} doesn't come in sizes`);
    }

    // Add-ons: each group's min/max is enforced, & only real options are accepted
    const chosen = line.modifiers ?? [];
    const groupNames = new Set(item.modifierGroups.map((g) => g.name));
    if (chosen.some((m) => !groupNames.has(m.group))) {
      throw new OrderError('INVALID_OPTION', `Unknown option for ${item.name}`);
    }

    const modifiers = [];
    for (const group of item.modifierGroups) {
      const picks = chosen.filter((m) => m.group === group.name);
      const distinct = new Set(picks.map((p) => p.option));
      if (distinct.size !== picks.length || picks.length < group.minSelect || picks.length > group.maxSelect) {
        throw new OrderError('INVALID_OPTION', `Please check the "${group.name}" choices for ${item.name}`);
      }
      for (const pick of picks) {
        const option = group.options.find((o) => o.name === pick.option);
        if (!option) throw new OrderError('INVALID_OPTION', `"${pick.option}" isn't available for ${item.name}`);
        modifiers.push({ group: group.name, option: option.name, priceDeltaMinor: option.priceDeltaMinor });
      }
    }

    const unitPriceMinor = basePrice + modifiers.reduce((sum, m) => sum + m.priceDeltaMinor, 0);
    return {
      menuItemId: item._id,
      name: item.name,
      variantName,
      modifiers,
      unitPriceMinor,
      qty: line.qty,
      notes: line.notes ?? '',
    };
  });

  const totalMinor = priced.reduce((sum, l) => sum + l.unitPriceMinor * l.qty, 0);
  return { items: priced, totalMinor };
}

export async function createOrder({
  restaurantId,
  deviceId,
  session,
  lines,
  idempotencyKey,
  expectedTotalMinor,
  placedBy = 'guest',
  staffId,
  guestPhone,
  notifyConsent = false,
}) {
  // A retry of an order that already went through: return the original, create nothing
  const existing = await Order.findOne({ restaurantId, idempotencyKey });
  if (existing) return { order: existing, duplicate: true };

  const { items, totalMinor } = await priceOrder(restaurantId, lines);

  if (expectedTotalMinor !== undefined && expectedTotalMinor !== totalMinor) {
    throw new OrderError('PRICE_CHANGED', 'Prices have changed. Please review your order.', 409, { totalMinor });
  }

  const wantsUpdates = Boolean(notifyConsent && guestPhone);

  try {
    const order = await Order.create({
      restaurantId,
      deviceId,
      tableId: session.tableId,
      tableNumber: session.tableNumber,
      sessionId: session._id,
      items,
      totalMinor,
      idempotencyKey,
      placedBy,
      placedByStaffId: staffId,
      guestPhone: wantsUpdates ? guestPhone : undefined, // stored only with consent
      notifyConsent: wantsUpdates,
    });
    await TableSession.updateOne({ _id: session._id }, { lastActivityAt: new Date() });
    return { order, duplicate: false };
  } catch (err) {
    // Two identical requests race each other, the unique index let only one in
    if (err.code === 11000) {
      const order = await Order.findOne({ restaurantId, idempotencyKey });
      return { order, duplicate: true };
    }
    throw err;
  }
}

// What a guest or staff screen is allowed to see. Never includes the phone number.
export function publicOrder(o) {
  return {
    id: o._id,
    tableNumber: o.tableNumber,
    items: o.items.map(({ name, variantName, modifiers, unitPriceMinor, qty, notes }) => ({
      name, variantName, modifiers, unitPriceMinor, qty, notes,
    })),
    totalMinor: o.totalMinor,
    status: o.status,
    placedBy: o.placedBy,
    updatedAt: o.updatedAt,
    createdAt: o.createdAt,
  };
}