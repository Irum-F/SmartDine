import { TableSession } from '../models/tableSession.js';
import { StaffRequest } from '../models/staffRequest.js';
import { Order } from '../models/order.js';
import { emitOrder, emitRequest, emitSessionClosed } from '../realtime/events.js';

const UNFINISHED = ['placed', 'cooking'];

// Closes a table. Unfinished food blocks it unless force is set, so nothing silently disappears.
export async function closeSession(filter, reason, { force = false } = {}) {
  const target = await TableSession.findOne({ ...filter, status: 'open' });
  if (!target) return { session: null };

  const unfinished = await Order.countDocuments({ sessionId: target._id, status: { $in: UNFINISHED } });
  if (unfinished > 0 && !force) return { session: null, unfinished };

  const session = await TableSession.findOneAndUpdate(
    { _id: target._id, status: 'open' },
    { status: 'closed', closedAt: new Date(), closedReason: reason },
    { new: true }
  );
  if (!session) return { session: null }; // someone else closed it a moment ago

  // Wrap up the table's orders so no ghost tickets stay on kitchen or floor screens:
  // food that was ready went out with the guests; anything unfinished is cancelled.
  const leftovers = await Order.find({ sessionId: session._id, status: { $in: [...UNFINISHED, 'ready'] } });
  for (const o of leftovers) {
    const updated = await Order.findOneAndUpdate(
      { _id: o._id, status: o.status }, // only if the kitchen didn't change it in the meantime
      { status: o.status === 'ready' ? 'served' : 'cancelled' },
      { new: true }
    );
    if (updated) emitOrder(updated);
  }

  const openRequests = await StaffRequest.find({ sessionId: session._id, status: 'open' });
  for (const r of openRequests) {
    r.status = 'resolved';
    await r.save();
    emitRequest(r); // clears the alert on every floor screen
  }

  emitSessionClosed(session);
  return { session };
}