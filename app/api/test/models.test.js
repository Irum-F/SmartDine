import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MenuItem } from '../src/models/menuItem.js';

// Loading each model catches errors like a schema used before it's defined
await import('../src/models/restaurant.js');
await import('../src/models/table.js');
await import('../src/models/staff.js');
await import('../src/models/tableSession.js');
await import('../src/models/order.js');
await import('../src/models/staffRequest.js');

const restaurantId = new mongoose.Types.ObjectId();

test('a menu item with sizes and add-ons is valid', async () => {
  const item = new MenuItem({
    restaurantId: new mongoose.Types.ObjectId(),
    name: 'Margherita',
    category: 'Mains',
    priceMinor: 34900,
    variants: [
      { name: 'Regular', priceMinor: 34900 },
      { name: 'Large', priceMinor: 49900 },
    ],
    modifierGroups: [
      { name: 'Add-ons', minSelect: 0, maxSelect: 3, options: [{ name: 'Extra cheese', priceDeltaMinor: 6000 }] },
    ],
  });
  await assert.doesNotReject(item.validate());
});