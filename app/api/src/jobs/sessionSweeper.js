import { config } from '../config.js';
import { logger } from '../logger.js';
import { TableSession } from '../models/tableSession.js';
import { Order } from '../models/order.js';
import { closeSession } from '../services/sessions.js';

const UNFINISHED = ['placed', 'cooking'];

// A waiter forgot to close a table: close it once it has been quiet for a while,
// but never while the kitchen still has food to make for it
export async function sweepIdleSessions(idleMinutes = config.SESSION_IDLE_MINUTES) {
  const cutoff = new Date(Date.now() - idleMinutes * 60_000);
  const stale = await TableSession.find({ status: 'open', lastActivityAt: { $lt: cutoff } }).limit(200);
  let closed = 0;
  for (const s of stale) {
    if (await Order.exists({ sessionId: s._id, status: { $in: UNFINISHED } })) continue;
    if (await closeSession({ _id: s._id, lastActivityAt: { $lt: cutoff } }, 'idle')) closed++;
  }
  if (closed) logger.info({ closed }, 'Closed idle table sessions');
  return closed;
}

export function startSessionSweeper(everyMs = 5 * 60_000) {
  const timer = setInterval(() => {
    sweepIdleSessions().catch((err) => logger.error({ err }, 'Session sweep failed'));
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}