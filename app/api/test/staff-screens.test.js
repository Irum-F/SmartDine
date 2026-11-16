import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { setup, teardown, resetDb, seedRestaurant, staffAgent } from './helpers.js';

let app;
before(async () => { app = await setup(); });
after(teardown);
beforeEach(resetDb);

const orderSoda = (fx) =>
  request(app)
    .post(`/api/t/${fx.table.qrToken}/orders`)
    .set('Idempotency-Key', randomUUID())
    .send({ items: [{ menuItemId: String(fx.soda._id), qty: 1 }], expectedTotalMinor: 9900 });

async function openTable(fx) {
  const waiter = await staffAgent(app);
  const res = await waiter.post(`/api/ops/tables/${fx.table._id}/open`);
  assert.equal(res.status, 201);
  return { waiter, sessionId: res.body.id };
}

test('/me tells the screens who is signed in and for which restaurant', async () => {
  const fx = await seedRestaurant();
  const res = await (await staffAgent(app)).get('/api/staff/me');
  assert.equal(res.status, 200);
  assert.equal(res.body.role, 'waiter');
  assert.equal(res.body.restaurant.slug, fx.restaurant.slug);
  assert.equal(res.body.restaurant.currency, 'INR');
});

test('only managers can see QR tokens', async () => {
  await seedRestaurant();
  const waiter = await (await staffAgent(app)).get('/api/ops/tables/qr');
  const manager = await (await staffAgent(app, 'bistro', 'mona')).get('/api/ops/tables/qr');
  assert.equal(waiter.status, 403);
  assert.equal(manager.status, 200);
  assert.ok(manager.body[0].qrToken);
});

test('closing a table with food still cooking needs confirmation, then cancels it', async () => {
  const fx = await seedRestaurant();
  const { waiter, sessionId } = await openTable(fx);
  const order = await orderSoda(fx);

  const blocked = await waiter.post(`/api/ops/sessions/${sessionId}/close`);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'HAS_UNFINISHED_ORDERS');
  assert.equal(blocked.body.details.unfinished, 1);

  const forced = await waiter.post(`/api/ops/sessions/${sessionId}/close`).send({ force: true });
  assert.equal(forced.status, 200);
  const after = await waiter.get(`/api/ops/sessions/${sessionId}/orders`);
  assert.equal(after.body.orders.find((o) => o.id === order.body.id).status, 'cancelled');
  assert.equal(after.body.billMinor, 0);
});

test('food that was ready is marked served when the table closes', async () => {
  const fx = await seedRestaurant();
  const { waiter, sessionId } = await openTable(fx);
  const order = await orderSoda(fx);
  const kitchen = await staffAgent(app, 'bistro', 'kiran');
  await kitchen.patch(`/api/ops/orders/${order.body.id}/status`).send({ status: 'cooking' });
  await kitchen.patch(`/api/ops/orders/${order.body.id}/status`).send({ status: 'ready' });

  const closed = await waiter.post(`/api/ops/sessions/${sessionId}/close`);
  assert.equal(closed.status, 200);
  const after = await waiter.get(`/api/ops/sessions/${sessionId}/orders`);
  assert.equal(after.body.orders[0].status, 'served');
  assert.equal(after.body.billMinor, 9900);
});

test('a replaced QR code stops working, and only a closed table can be replaced', async () => {
  const fx = await seedRestaurant();
  const { waiter, sessionId } = await openTable(fx);
  const manager = await staffAgent(app, 'bistro', 'mona');
  const url = `/api/ops/tables/${fx.table._id}/rotate-qr`;

  assert.equal((await manager.post(url)).status, 409);
  await waiter.post(`/api/ops/sessions/${sessionId}/close`);

  const rotated = await manager.post(url);
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.body.qrToken, fx.table.qrToken);
  assert.equal((await request(app).get(`/api/t/${fx.table.qrToken}`)).status, 404);
  assert.equal((await request(app).get(`/api/t/${rotated.body.qrToken}`)).status, 200);
});