import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { Restaurant } from '../src/models/restaurant.js';
import { Table } from '../src/models/table.js';
import { MenuItem } from '../src/models/menuItem.js';
import { hashPin } from '../src/lib/pin.js';

const pin = process.env.SEED_STAFF_PIN;
if (!pin) {
  console.error('Set SEED_STAFF_PIN before seeding (it becomes the staff login PIN).');
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);

const slug = 'demo-bistro';
const existing = await Restaurant.findOne({ slug });
if (existing) {
  await Promise.all([
    Table.deleteMany({ restaurantId: existing._id }),
    MenuItem.deleteMany({ restaurantId: existing._id }),
    Restaurant.deleteOne({ _id: existing._id }),
  ]);
}

const restaurant = await Restaurant.create({ name: 'Demo Bistro', slug, staffPinHash: hashPin(pin) });

const tables = await Table.insertMany(
  Array.from({ length: 10 }, (_, i) => ({
    restaurantId: restaurant._id,
    number: i + 1,
    qrToken: randomBytes(16).toString('base64url'),
  }))
);

await MenuItem.insertMany([
  { name: 'Margherita Pizza', category: 'Mains', priceMinor: 34900, dietary: ['veg'], sortOrder: 1 },
  { name: 'Paneer Tikka', category: 'Starters', priceMinor: 27900, dietary: ['veg', 'spicy'], sortOrder: 1 },
  { name: 'Chicken Wings', category: 'Starters', priceMinor: 29900, dietary: ['spicy'], sortOrder: 2 },
  { name: 'Pasta Alfredo', category: 'Mains', priceMinor: 32900, dietary: ['veg'], sortOrder: 2 },
  { name: 'Grilled Chicken', category: 'Mains', priceMinor: 39900, dietary: ['gluten-free'], sortOrder: 3 },
  { name: 'Vegan Buddha Bowl', category: 'Mains', priceMinor: 31900, dietary: ['vegan', 'gluten-free'], sortOrder: 4 },
  { name: 'Fresh Lime Soda', category: 'Drinks', priceMinor: 9900, dietary: ['vegan'], sortOrder: 1 },
  { name: 'Chocolate Brownie', category: 'Desserts', priceMinor: 19900, dietary: ['veg', 'contains-nuts'], sortOrder: 1 },
].map((item) => ({ ...item, restaurantId: restaurant._id })));

console.log(`Seeded "${restaurant.name}" with ${tables.length} tables.`);
console.log('Table QR tokens (for local testing):');
for (const t of tables) console.log(`  Table ${t.number}: ${t.qrToken}`);

await mongoose.disconnect();