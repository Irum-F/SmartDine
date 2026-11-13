import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setup, teardown, resetDb, seedRestaurant, Staff, hashPin } from './helpers.js';

let app;
before(async () => { app = await setup(); });
after(teardown);
beforeEach(resetDb);

const login = (slug, username, pin) =>
  request(app).post('/api/staff/login').send({ restaurantSlug: slug, username, pin });

async function addStaff(restaurantId, username, role, pin) {
  return Staff.create({ restaurantId, name: username, username, role, pinHash: await hashPin(pin), mustChangePin: false });
}

async function lockWendy(slug) {
  for (let i = 0; i < 5; i++) await login(slug, 'wendy', '000000');
}

test('a locked account answers exactly like an unknown user, even with the right PIN', async () => {
  const fx = await seedRestaurant();
  await lockWendy(fx.restaurant.slug);
  const locked = await login(fx.restaurant.slug, 'wendy', '482913');
  const unknown = await login(fx.restaurant.slug, 'nobody', '482913');
  assert.equal(locked.status, 401);
  assert.deepEqual(locked.body, unknown.body);
});

test('a manager can see the lock and undo it', async () => {
  const fx = await seedRestaurant();
  await addStaff(fx.restaurant._id, 'maya', 'manager', '739204');
  await lockWendy(fx.restaurant.slug);

  const manager = request.agent(app);
  await manager.post('/api/staff/login').send({ restaurantSlug: fx.restaurant.slug, username: 'maya', pin: '739204' });

  const list = await manager.get('/api/ops/staff');
  const wendy = list.body.find((s) => s.username === 'wendy');
  assert.equal(wendy.locked, true);

  const unlock = await manager.post(`/api/ops/staff/${wendy.id}/unlock`);
  assert.equal(unlock.status, 200);
  assert.equal((await login(fx.restaurant.slug, 'wendy', '482913')).status, 200);
});

test('a waiter cannot unlock anyone', async () => {
  const fx = await seedRestaurant();
  const other = await addStaff(fx.restaurant._id, 'walt', 'waiter', '615283');
  const waiter = request.agent(app);
  await waiter.post('/api/staff/login').send({ restaurantSlug: fx.restaurant.slug, username: 'wendy', pin: '482913' });
  const res = await waiter.post(`/api/ops/staff/${other._id}/unlock`);
  assert.equal(res.status, 403);
});

test("a manager can't unlock an owner or another restaurant's staff", async () => {
  const mine = await seedRestaurant('bistro');
  const theirs = await seedRestaurant('rival');
  await addStaff(mine.restaurant._id, 'maya', 'manager', '739204');
  const owner = await addStaff(mine.restaurant._id, 'olga', 'owner', '850317');
  const rivalWendy = await Staff.findOne({ restaurantId: theirs.restaurant._id, username: 'wendy' });

  const manager = request.agent(app);
  await manager.post('/api/staff/login').send({ restaurantSlug: 'bistro', username: 'maya', pin: '739204' });

  assert.equal((await manager.post(`/api/ops/staff/${owner._id}/unlock`)).status, 404);
  assert.equal((await manager.post(`/api/ops/staff/${rivalWendy._id}/unlock`)).status, 404);
});

async function managerAgent(slug) {
  const agent = request.agent(app);
  const res = await agent.post('/api/staff/login').send({ restaurantSlug: slug, username: 'maya', pin: '739204' });
  assert.equal(res.status, 200);
  return agent;
}

test('a manager resets a forgotten PIN: old PIN and old sessions stop working', async () => {
  const fx = await seedRestaurant();
  await addStaff(fx.restaurant._id, 'maya', 'manager', '739204');
  const wendy = await Staff.findOne({ username: 'wendy' });

  const oldSession = request.agent(app);
  await oldSession.post('/api/staff/login').send({ restaurantSlug: fx.restaurant.slug, username: 'wendy', pin: '482913' });

  const manager = await managerAgent(fx.restaurant.slug);
  const reset = await manager.post(`/api/ops/staff/${wendy._id}/reset-pin`);
  assert.equal(reset.status, 200);
  assert.match(reset.body.temporaryPin, /^\d{6}$/);
  assert.equal(reset.headers['cache-control'], 'no-store');

  assert.equal((await login(fx.restaurant.slug, 'wendy', '482913')).status, 401);
  assert.equal((await oldSession.get('/api/staff/me')).status, 401);
  assert.equal((await login(fx.restaurant.slug, 'wendy', reset.body.temporaryPin)).status, 200);
  assert.equal((await Staff.findById(wendy._id)).mustChangePin, true);
});

test('a waiter cannot reset PINs', async () => {
  const fx = await seedRestaurant();
  const other = await addStaff(fx.restaurant._id, 'walt', 'waiter', '615283');
  const waiter = request.agent(app);
  await waiter.post('/api/staff/login').send({ restaurantSlug: fx.restaurant.slug, username: 'wendy', pin: '482913' });
  assert.equal((await waiter.post(`/api/ops/staff/${other._id}/reset-pin`)).status, 403);
});

test("a manager can't reset their own PIN, an owner's, or another restaurant's staff", async () => {
  const mine = await seedRestaurant('bistro');
  const theirs = await seedRestaurant('rival');
  const maya = await addStaff(mine.restaurant._id, 'maya', 'manager', '739204');
  const owner = await addStaff(mine.restaurant._id, 'olga', 'owner', '850317');
  const rivalWendy = await Staff.findOne({ restaurantId: theirs.restaurant._id, username: 'wendy' });

  const manager = await managerAgent('bistro');
  assert.equal((await manager.post(`/api/ops/staff/${maya._id}/reset-pin`)).status, 400);
  assert.equal((await manager.post(`/api/ops/staff/${owner._id}/reset-pin`)).status, 404);
  assert.equal((await manager.post(`/api/ops/staff/${rivalWendy._id}/reset-pin`)).status, 404);
});