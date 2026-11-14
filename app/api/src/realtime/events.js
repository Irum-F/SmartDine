import { publicOrder } from '../services/orders.js';

let io = null;
export const setIo = (instance) => { io = instance; };

export const rooms = {
  kitchen: (rid) => `r:${rid}:kitchen`,
  floor: (rid) => `r:${rid}:floor`,
  menu: (rid) => `r:${rid}:menu`,
  table: (tid) => `t:${tid}`,
  session: (sid) => `s:${sid}`,
  staff: (id) => `staff:${id}`,
};

function send(targets, event, payload) {
  if (!io) return;
  let op = io;
  for (const room of targets) op = op.to(room);
  op.emit(event, payload);
}

// Kitchen, floor and that table's guests all get the full order, so screens just replace it by id
export function emitOrder(order) {
  const rid = order.restaurantId;
  send([rooms.kitchen(rid), rooms.floor(rid), rooms.session(order.sessionId)], 'order:update', publicOrder(order));
}

export function emitRequest(r) {
  send([rooms.floor(r.restaurantId)], 'request:update', {
    id: r._id, type: r.type, tableNumber: r.tableNumber, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt,
  });
}

export function emitAvailability(item) {
  const rid = item.restaurantId;
  send([rooms.menu(rid), rooms.kitchen(rid), rooms.floor(rid)], 'menu:availability', { id: item._id, available: item.available });
}

export function emitBusy(restaurant) {
  const rid = restaurant._id;
  send([rooms.menu(rid), rooms.kitchen(rid), rooms.floor(rid)], 'restaurant:busy', { busyMode: restaurant.busyMode });
}

const sessionPayload = (s) => ({ id: s._id, tableId: s.tableId, tableNumber: s.tableNumber, status: s.status, reason: s.closedReason });

export function emitSessionOpened(session) {
  if (!io) return;
  // Guests already looking at the menu on this table start receiving its order updates
  io.in(rooms.table(session.tableId)).socketsJoin(rooms.session(session._id));
  send([rooms.floor(session.restaurantId), rooms.table(session.tableId)], 'session:update', sessionPayload(session));
}

export function emitSessionClosed(session) {
  if (!io) return;
  send([rooms.floor(session.restaurantId), rooms.table(session.tableId)], 'session:update', sessionPayload(session));
  // Phones on this table stop receiving order updates for the session that just ended
  io.in(rooms.session(session._id)).socketsLeave(rooms.session(session._id));
}

// Logout, PIN change or deactivation: drop that person's live connections on every container
export function disconnectStaff(staffId) {
  if (io) io.in(rooms.staff(staffId)).disconnectSockets(true);
}