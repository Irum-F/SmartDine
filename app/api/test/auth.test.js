import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Settings must exist before the app's config is loaded
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-that-is-long-enough-123456';
process.env.MONGODB_URI = 'mongodb://not-used-in-tests';

const { createApp } = await import('../src/app.js');
const { Restaurant } = await import('../src/models/restaurant.js');
const { Staff } = await import('../src/models/staff.js');
const { hashPin } = await import('../src/lib/pin.js');

let mongod;
let app;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = createApp();
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
});

async function makeStaff({ mustChangePin = false } = {}) {
  const r = await Restaurant.create({ name: 'Bistro', slug: 'bistro' });
  await Staff.create({
    restaurantId: r._id, name: 'Wendy', username: 'wendy', role: 'waiter',
    pinHash: hashPin('482913'), mustChangePin,
  });
}

const login = (pin, agent = request(app)) =>
  agent.post('/api/staff/login').send({ restaurantSlug: 'bistro', username: 'wendy', pin });

test('a correct PIN signs in with an httpOnly cookie', async () => {
  await makeStaff();
  const res = await login('482913');
  assert.equal(res.status, 200);
  const cookie = res.headers['set-cookie'].join(';');
  assert.match(cookie, /sd_staff=/);
  assert.match(cookie, /HttpOnly/);
});

test('wrong PIN and unknown user get the same message', async () => {
  await makeStaff();
  const wrongPin = await login('111999');
  const unknown = await request(app).post('/api/staff/login')
    .send({ restaurantSlug: 'bistro', username: 'nobody', pin: '111999' });
  assert.equal(wrongPin.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(wrongPin.body, unknown.body);
});

test('five wrong PINs lock the account, even for the right PIN', async () => {
  await makeStaff();
  for (let i = 0; i < 5; i++) await login('111999');
  const res = await login('482913');
  assert.equal(res.status, 423);
});

test('changing the PIN signs out older sessions', async () => {
  await makeStaff({ mustChangePin: true });
  const agent = request.agent(app);
  const first = await login('482913', agent);
  assert.equal(first.body.mustChangePin, true);
  const oldCookie = first.headers['set-cookie'];

  const change = await agent.post('/api/staff/change-pin').send({ currentPin: '482913', newPin: '905172' });
  assert.equal(change.status, 200);

  const stale = await request(app).get('/api/staff/me').set('Cookie', oldCookie);
  assert.equal(stale.status, 401);

  const fresh = await agent.get('/api/staff/me');
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.mustChangePin, false);
});

test('weak PINs are rejected', async () => {
  await makeStaff({ mustChangePin: true });
  const agent = request.agent(app);
  await login('482913', agent);
  const res = await agent.post('/api/staff/change-pin').send({ currentPin: '482913', newPin: '123456' });
  assert.equal(res.status, 400);
});