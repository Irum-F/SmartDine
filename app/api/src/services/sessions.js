import { TableSession } from '../models/tableSession.js';
import { StaffRequest } from '../models/staffRequest.js';
import { emitSessionClosed } from '../realtime/events.js';

// The status:'open' condition makes this safe when two containers try at once: only one wins
export async function closeSession(filter, reason) {
  const session = await TableSession.findOneAndUpdate(
    { ...filter, status: 'open' },
    { status: 'closed', closedAt: new Date(), closedReason: reason },
    { new: true }
  );
  if (!session) return null;
  await StaffRequest.updateMany({ sessionId: session._id, status: 'open' }, { status: 'resolved' });
  emitSessionClosed(session);
  return session;
}