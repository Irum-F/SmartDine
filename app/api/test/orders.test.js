import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { setup, teardown, resetDb, seedRestaurant, staffAgent } from './helpers.js';

let app;
before(async () => { app = await setup(); });
after(teardown);
beforeEach(resetDb);

const placeOrder = (qr, body, key = randomUUID()) =>
  request(app).post(`/api/t/${qr}/orders`).set('Idempotency-Key', key).send(body);

async function openTable(fx) {
  const staff = await staffAgent(app, fx.restaurant.slug);
  const res = await staff.post(`/api/ops/tables/${fx.table._id}/open`);
  assert.equal(res.status, 201);
  return staff;
}

const largePizzaOrder = (fx, expectedTotalMinor) => ({
  items: [
    {
      menuItemId: String(fx.pizza._id),
      variantName: 'Large',
      modifiers: [{ group: 'Add-ons', option: 'Extra cheese' }],
      qty: 2,
    },
    { menuItemId: String(fx.soda._id), qty: 1 },
  ],
  expectedTotalMinor,
});

// (49900 + 6000) × 2 + 9900
const EXPECTED_TOTAL = 121700;

test('guests cannot order until a waiter opens the table', async () => {
  const fx = await seedRestaurant();
  const res = await placeOrder(fx.table.qrToken, largePizzaOrder(fx, EXPECTED_TOTAL));
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'TABLE_NOT_OPEN');
});

test('the server prices sizes and add-ons itself', async () => {
  const fx = await seedRestaurant();
  await openTable(fx);
  const res = await placeOrder(fx.table.qrToken, largePizzaOrder(fx, EXPECTED_TOTAL));
  assert.equal(res.status, 201);
  assert.equal(res.body.totalMinor, EXPECTED_TOTAL);
  assert.equal(res.body.items[0].unitPriceMinor, 55900);
});

test('retrying with the same idempotency key creates only one order', async () => {
  const fx = await seedRestaurant();
  await openTable(fx);
  const key = randomUUID();
  const first = await placeOrder(fx.table.qrToken, largePizzaOrder(fx, EXPECTED_TOTAL), key);
  const retry = await placeOrder(fx.table.qrToken, largePizzaOrder(fx, EXPECTED_TOTAL), key);
  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.id, first.body.id);

  const list = await request(app).get(`/api/t/${fx.table.qrToken}/orders`);
  assert.equal(list.body.length, 1);
});

test('sold-out items are rejected at the moment of ordering', async () => {
  const fx = await seedRestaurant();
  await openTable(fx);
  fx.soda.available = false;
  await fx.soda.save();
  const res = await placeOrder(fx.table.qrToken, largePizzaOrder(fx, EXPECTED_TOTAL));
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'ITEM_UNAVAILABLE');
  assert.deepEqual(res.body.details.menuItemIds, [String(fx.soda._id)]);
});

test('a changed price is refused with the new total', async () => {
  const fx = await seedRestaurant();
  await openTable(fx);
  const res = await placeOrder(fx.table.qrToken, largePizzaOrder(fx, 100000));
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'PRICE_CHANGED');
  assert.equal(res.body.details.totalMinor, EXPECTED_TOTAL);
});

test('a table can only be opened once at a time', async () => {
  const fx = await seedRestaurant();
  const staff = await openTable(fx);
  const again = await staff.post(`/api/ops/tables/${fx.table._id}/open`);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'TABLE_ALREADY_OPEN');
});

test("staff can't open another restaurant's table", async () => {
  const mine = await seedRestaurant('bistro');
  const theirs = await seedRestaurant('rival');
  const staff = await staffAgent(app, mine.restaurant.slug);
  const res = await staff.post(`/api/ops/tables/${theirs.table._id}/open`);
  assert.equal(res.status, 404);
});

test('only the phone that placed an order can cancel it, once, before cooking', async () => {
  const fx = await seedRestaurant();
  await openTable(fx);
  const phone = request.agent(app);
  const order = await phone
    .post(`/api/t/${fx.table.qrToken}/orders`)
    .set('Idempotency-Key', randomUUID())
    .send(largePizzaOrder(fx, EXPECTED_TOTAL));
  const url = `/api/t/${fx.table.qrToken}/orders/${order.body.id}/cancel`;

  const stranger = await request(app).post(url);
  const first = await phone.post(url);
  const second = await phone.post(url);
  assert.equal(stranger.status, 409);
  assert.equal(first.status, 200);
  assert.equal(first.body.status, 'cancelled');
  assert.equal(second.status, 409);
});