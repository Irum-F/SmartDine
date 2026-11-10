import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

// Loading each model catches errors like a schema used before it's defined
const { MenuItem } = await import('../src/models/menuItem.js');
await import('../src/models/restaurant.js');
await import('../src/models/table.js');
await import('../src/models/staff.js');
await import('../src/models/tableSession.js');
await import('../src/models/order.js');
await import('../src/models/staffRequest.js');

const restaurantId = new mongoose.Types.ObjectId();

test('a menu item with sizes and add-ons is valid', () => {
  const item = new MenuItem({
    restaurantId, name: 'Pizza', category: 'Mains', priceMinor: 34900,
    variants: [{ name: 'Large', priceMinor: 49900 }],
    modifierGroups: [{ name: 'Add-ons', maxSelect: 2, options: [{ name: 'Extra cheese', priceDeltaMinor: 6000 }] }],
  });
  assert.equal(item.validateSync(), undefined);
});

test('a price with decimals is rejected', () => {
  const item = new MenuItem({ restaurantId, name: 'Soup', category: 'Starters', priceMinor: 99.5 });
  assert.ok(item.validateSync()?.errors.priceMinor);
});