import { randomBytes, randomInt } from 'node:crypto';
import mongoose from 'mongoose';
import { Restaurant } from '../src/models/restaurant.js';
import { Table } from '../src/models/table.js';
import { MenuItem } from '../src/models/menuItem.js';
import { Staff } from '../src/models/staff.js';
import { TableSession } from '../src/models/tableSession.js';
import { Order } from '../src/models/order.js';
import { StaffRequest } from '../src/models/staffRequest.js';
import { hashPin } from '../src/lib/pin.js';

if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'yes') {
  console.error('Refusing to seed production without SEED_ALLOW_PRODUCTION=yes');
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);

const slug = 'demo-bistro';
const existing = await Restaurant.findOne({ slug });
if (existing) {
  const restaurantId = existing._id;
  await Promise.all(
    [Table, MenuItem, Staff, TableSession, Order, StaffRequest].map((M) => M.deleteMany({ restaurantId }))
  );
  await Restaurant.deleteOne({ _id: restaurantId });
}

const restaurant = await Restaurant.create({ name: 'Demo Bistro', slug });
const restaurantId = restaurant._id;

const tables = await Table.insertMany(
  Array.from({ length: 10 }, (_, i) => ({
    restaurantId,
    number: i + 1,
    qrToken: randomBytes(16).toString('base64url'),
  }))
);

console.log('Table QR tokens:');
for (const t of tables) console.log(`  Table ${t.number}: ${t.qrToken}`);

await MenuItem.insertMany(
  [
    {
      name: 'Margherita Pizza', category: 'Mains', priceMinor: 34900, dietary: ['veg'], sortOrder: 1,
      variants: [{ name: 'Regular', priceMinor: 34900 }, { name: 'Large', priceMinor: 49900 }],
      modifierGroups: [{
        name: 'Add-ons', minSelect: 0, maxSelect: 3,
        options: [
          { name: 'Extra cheese', priceDeltaMinor: 6000 },
          { name: 'Olives', priceDeltaMinor: 4000 },
          { name: 'Jalapeños', priceDeltaMinor: 4000 },
        ],
      }],
    },
    {
      name: 'Paneer Tikka', category: 'Starters', priceMinor: 27900, dietary: ['veg', 'spicy'], sortOrder: 1,
      modifierGroups: [{
        name: 'Spice level', minSelect: 1, maxSelect: 1,
        options: [{ name: 'Mild' }, { name: 'Medium' }, { name: 'Hot' }],
      }],
    },
    { name: 'Chicken Wings', category: 'Starters', priceMinor: 29900, dietary: ['spicy'], sortOrder: 2 },
    { name: 'Pasta Alfredo', category: 'Mains', priceMinor: 32900, dietary: ['veg'], sortOrder: 2 },
    { name: 'Grilled Chicken', category: 'Mains', priceMinor: 39900, dietary: ['gluten-free'], sortOrder: 3 },
    { name: 'Vegan Buddha Bowl', category: 'Mains', priceMinor: 31900, dietary: ['vegan', 'gluten-free'], sortOrder: 4 },
    { name: 'Fresh Lime Soda', category: 'Drinks', priceMinor: 9900, dietary: ['vegan'], sortOrder: 1 },
    { name: 'Chocolate Brownie', category: 'Desserts', priceMinor: 19900, dietary: ['veg', 'contains-nuts'], sortOrder: 1 },
  ].map((item) => ({ ...item, restaurantId }))
);

const staffSeed = [
  { name: 'Owner', username: 'owner', role: 'owner' },
  { name: 'Manager', username: 'manager', role: 'manager' },
  { name: 'Waiter', username: 'waiter', role: 'waiter' },
  { name: 'Kitchen', username: 'kitchen', role: 'kitchen' },
];

console.log(`Seeded "${restaurant.name}" (slug: ${slug}) with ${tables.length} tables.`);
console.log('Staff accounts. Each must change their PIN at first login:');
for (const s of staffSeed) {
  const pin = String(randomInt(100000, 1000000));
  await Staff.create({ ...s, restaurantId, pinHash: hashPin(pin), mustChangePin: true });
  console.log(`  ${s.username.padEnd(8)} ${s.role.padEnd(8)} temporary PIN: ${pin}`);
}

await mongoose.disconnect();