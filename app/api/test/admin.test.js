import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { setup, teardown, resetDb, seedRestaurant, staffAgent } from './helpers.js';

let app;
before(async () => { app = await setup(); });
after(teardown);
beforeEach(resetDb);

const manager = () => staffAgent(app, 'bistro', 'mona');
const login = (username, pin) => request(app).post('/api/staff/login').send({ restaurantSlug: 'bistro', username, pin });
const staffId = async (agent, username) => (await agent.get('/api/admin/staff')).body.find((s) => s.username === username).id;

const burger = {
  name: 'Smash Burger',
  category: 'Mains',
  priceMinor: 0,
  dietary: ['non-veg'],
  variants: [{ name: 'Single', priceMinor: 29900 }, { name: 'Double', priceMinor: 39900 }],
  modifierGroups: [{ name: 'Cheese', minSelect: 0, maxSelect: 1, options: [{ name: 'Cheddar', priceDeltaMinor: 3000 }] }],
};

test('only managers can use the back office', async () => {
  await seedRestaurant();
  assert.equal((await (await staffAgent(app)).get('/api/admin/menu')).status, 403);
  assert.equal((await (await manager()).get('/api/admin/menu')).status, 200);
});

test('a new item reaches the guest menu, priced from its cheapest size', async () => {
  const fx = await seedRestaurant();
  const res = await (await manager()).post('/api/admin/menu').send(burger);
  assert.equal(res.status, 201);
  assert.equal(res.body.priceMinor, 29900);
  const menu = await request(app).get(`/api/t/${fx.table.qrToken}`);
  assert.ok(menu.body.menu.some((i) => i.name === 'Smash Burger'));
});

test('impossible add-on rules are refused with a clear reason', async () => {
  await seedRestaurant();
  const bad = { ...burger, modifierGroups: [{ name: 'Cheese', minSelect: 2, maxSelect: 1, options: [{ name: 'Cheddar', priceDeltaMinor: 0 }] }] };
  const res = await (await manager()).post('/api/admin/menu').send(bad);
  assert.equal(res.status, 400);
  assert.match(JSON.stringify(res.body.details), /minimum/);
});

test('a price change applies to new orders and is logged with before and after', async () => {
  const fx = await seedRestaurant();
  const m = await manager();
  const saved = await m.put(`/api/admin/menu/${fx.soda._id}`).send({ name: 'Lime Soda', category: 'Drinks', priceMinor: 12900 });
  assert.equal(saved.status, 200);

  await (await staffAgent(app)).post(`/api/ops/tables/${fx.table._id}/open`);
  const order = await request(app)
    .post(`/api/t/${fx.table.qrToken}/orders`)
    .set('Idempotency-Key', randomUUID())
    .send({ items: [{ menuItemId: String(fx.soda._id), qty: 1 }], expectedTotalMinor: 9900 });
  assert.equal(order.body.code, 'PRICE_CHANGED');
  assert.equal(order.body.details.totalMinor, 12900);

  const log = await m.get('/api/admin/audit');
  assert.match(log.body[0].summary, /Lime Soda.*₹99.*₹129/);
});

test('managers can add waiters but not managers; usernames are lowercase and unique', async () => {
  await seedRestaurant();
  const m = await manager();
  assert.equal((await m.post('/api/admin/staff').send({ name: 'Max', username: 'max', role: 'manager' })).status, 403);

  const created = await m.post('/api/admin/staff').send({ name: 'Ravi', username: 'Ravi', role: 'waiter' });
  assert.equal(created.status, 201);
  assert.equal(created.body.username, 'ravi');
  assert.match(created.body.temporaryPin, /^\d{6}$/);
  assert.equal((await login('ravi', created.body.temporaryPin)).status, 200);
  assert.equal((await m.post('/api/admin/staff').send({ name: 'Ravi 2', username: 'ravi', role: 'waiter' })).status, 409);
});

test('deactivating someone signs them out at once, and nobody can lock themselves out', async () => {
  await seedRestaurant();
  const wendy = await staffAgent(app);
  const m = await manager();
  assert.equal((await m.patch(`/api/admin/staff/${await staffId(m, 'wendy')}`).send({ active: false })).status, 200);
  assert.equal((await wendy.get('/api/staff/me')).status, 401);
  assert.equal((await m.patch(`/api/admin/staff/${await staffId(m, 'mona')}`).send({ active: false })).status, 403);
});

test('resetting a PIN makes the old one stop working', async () => {
  await seedRestaurant();
  const m = await manager();
  const reset = await m.post(`/api/admin/staff/${await staffId(m, 'kiran')}/reset-pin`);
  assert.equal(reset.status, 200);
  assert.notEqual((await login('kiran', '482913')).status, 200);
  assert.equal((await login('kiran', reset.body.temporaryPin)).status, 200);
});

test("tables: no duplicate numbers, and a table with guests can't be removed", async () => {
  const fx = await seedRestaurant();
  const m = await manager();
  assert.equal((await m.post('/api/admin/tables').send({ number: 2 })).status, 201);
  assert.equal((await m.post('/api/admin/tables').send({ number: 2 })).status, 409);
  await (await staffAgent(app)).post(`/api/ops/tables/${fx.table._id}/open`);
  assert.equal((await m.patch(`/api/admin/tables/${fx.table._id}`).send({ active: false })).status, 409);
});

test('the category order in settings is the order guests see, and bad hours are refused', async () => {
  const fx = await seedRestaurant();
  const m = await manager();
  const base = { name: 'bistro', showVegSymbols: true, openingHours: [] };

  assert.equal((await m.put('/api/admin/settings').send({ ...base, categories: ['Mains', 'Drinks'] })).status, 200);
  const menu = await request(app).get(`/api/t/${fx.table.qrToken}`);
  assert.equal(menu.body.menu[0].category, 'Mains');

  const bad = await m.put('/api/admin/settings').send({ ...base, categories: [], openingHours: [{ day: 1, open: '25:00', close: '23:00' }] });
  assert.equal(bad.status, 400);
});