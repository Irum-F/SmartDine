// One-off: orders left unfinished on tables closed before closing wrapped them up.
// Ready food went out with the guests (→ served); anything still placed or cooking is cancelled.
// Dry run by default. Set APPLY=yes to change data.
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { Order } from '../src/models/order.js';
import { TableSession } from '../src/models/tableSession.js';

await mongoose.connect(config.MONGODB_URI);

const closedIds = (await TableSession.find({ status: 'closed' }, '_id').lean()).map((s) => s._id);
const readyFilter = { sessionId: { $in: closedIds }, status: 'ready' };
const unfinishedFilter = { sessionId: { $in: closedIds }, status: { $in: ['placed', 'cooking'] } };

const ready = await Order.countDocuments(readyFilter);
const unfinished = await Order.countDocuments(unfinishedFilter);
console.log(`Orphans found: ${ready} ready → served, ${unfinished} placed/cooking → cancelled`);

if (process.env.APPLY === 'yes') {
  await Order.updateMany(readyFilter, { status: 'served' });
  await Order.updateMany(unfinishedFilter, { status: 'cancelled' });
  console.log('Applied.');
} else {
  console.log('Dry run only. Run again with APPLY=yes to apply.');
}

await mongoose.disconnect();