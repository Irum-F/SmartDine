// Settings must exist before the app's config loads, so app modules are imported after it
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-that-is-long-enough-123456';
process.env.MONGODB_URI = 'mongodb://not-used-in-tests';

const { default: mongoose } = await import('mongoose');
const { MongoMemoryServer } = await import('mongodb-memory-server');
const { default: request } = await import('supertest');
const { createApp } = await import('../src/app.js');
const { Restaurant } = await import('../src/models/restaurant.js');
const { Table } = await import('../src/models/table.js');
const { MenuItem } = await import('../src/models/menuItem.js');
const { Staff } = await import('../src/models/staff.js');
const { hashPin } = await import('../src/lib/pin.js');

let mongod;

export async function setup() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).syncIndexes())); // syncIndexes() builds the unique indexes before tests run. Without it, the duplicate-protection tests could pass or fail by luck, depending on whether the index exists yet
  return createApp();
}

export async function teardown() {
  await mongoose.disconnect();
  await mongod.stop();
}

export async function resetDb() {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
}

export async function seedRestaurant(slug = 'bistro') {
  const restaurant = await Restaurant.create({ name: slug, slug });
  const restaurantId = restaurant._id;
  const table = await Table.create({ restaurantId, number: 1, qrToken: `qr-${slug}-table-1-abcdef` });
  const pizza = await MenuItem.create({
    restaurantId, name: 'Margherita', category: 'Mains', priceMinor: 34900,
    variants: [{ name: 'Regular', priceMinor: 34900 }, { name: 'Large', priceMinor: 49900 }],
    modifierGroups: [{ name: 'Add-ons', minSelect: 0, maxSelect: 3, options: [{ name: 'Extra cheese', priceDeltaMinor: 6000 }] }],
  });
  const soda = await MenuItem.create({ restaurantId, name: 'Lime Soda', category: 'Drinks', priceMinor: 9900 });
  await Staff.create({
    restaurantId, name: 'Wendy', username: 'wendy', role: 'waiter',
    pinHash: hashPin('482913'), mustChangePin: false,
  });
  return { restaurant, table, pizza, soda };
}

export async function staffAgent(app, slug = 'bistro') {
  const agent = request.agent(app);
  const res = await agent.post('/api/staff/login').send({ restaurantSlug: slug, username: 'wendy', pin: '482913' });
  if (res.status !== 200) throw new Error(`Test login failed: ${res.status}`);
  return agent;
}