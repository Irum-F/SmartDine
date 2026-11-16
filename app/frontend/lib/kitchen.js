export const KITCHEN = ['owner', 'manager', 'kitchen'];
export const FLOOR = ['owner', 'manager', 'waiter'];
export const MANAGERS = ['owner', 'manager'];

export const STATUS_LABEL = { placed: 'New', cooking: 'Cooking', ready: 'Ready', served: 'Served', cancelled: 'Cancelled' };

// Mirrors TRANSITIONS in the API. The API is the real check; this only decides which buttons to show.
const NEXT = {
  placed: { to: 'cooking', label: 'Start cooking', roles: KITCHEN },
  cooking: { to: 'ready', label: 'Mark ready', roles: KITCHEN },
  ready: { to: 'served', label: 'Mark served', roles: FLOOR },
};

export function nextAction(role, status) {
  const action = NEXT[status];
  return action && action.roles.includes(role) ? action : null;
}

export function canCancel(role, status) {
  return MANAGERS.includes(role) && (status === 'placed' || status === 'cooking');
}

export function minutesSince(iso, now = Date.now()) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

// Ticket colour by age: amber from 15 minutes, red from 25
export function ageClass(minutes) {
  return minutes >= 25 ? 'late' : minutes >= 15 ? 'warn' : '';
}

const orderDone = (o) => o.status === 'served' || o.status === 'cancelled';
export const requestDone = (r) => r.status === 'resolved';

export const isNewer = (current, incoming) => !current || new Date(incoming.updatedAt) >= new Date(current.updatedAt);

// Apply one live update: newer wins, finished items leave the screen
export function applyUpdate(map, item, isDone = orderDone) {
  if (!isNewer(map.get(item.id), item)) return map;
  const next = new Map(map);
  if (isDone(item)) next.delete(item.id);
  else next.set(item.id, item);
  return next;
}

// Take a fresh list from the server, but keep anything a live event delivered
// after that list was made, so nothing new disappears for 30 seconds (fix 3)
export function mergeSnapshot(map, list, serverTime, isDone = orderDone) {
  const next = new Map();
  for (const item of list) {
    const old = map.get(item.id);
    const pick = isNewer(old, item) ? item : old;
    if (!isDone(pick)) next.set(item.id, pick);
  }
  for (const [id, item] of map) {
    if (!next.has(id) && !isDone(item) && new Date(item.updatedAt) > new Date(serverTime)) next.set(id, item);
  }
  return next;
}