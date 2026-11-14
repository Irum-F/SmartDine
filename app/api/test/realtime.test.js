import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { io as connect } from 'socket.io-client';
import { setup, teardown, resetDb, seedRestaurant } from './helpers.js';

// Imported after helpers.js has set the test environment
const { initRealtime } = await import('../src/realtime/index.js');
const { sweepIdleSessions } = await import('../src/jobs/sessionSweeper.js');
const { TableSession } = await import('../src/models/tableSession.js');
const { Order } = await import('../src/models/order.js');

let server;
let url;
let realtime;
const sockets = [];

before(async () => {
  const app = await setup();
  server = createServer(app);
  realtime = await initRealtime(server);
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await realtime.close();
  await new Promise((resolve) => server.close(resolve));
  await teardown();
});
beforeEach(resetDb);
afterEach(() => sockets.splice(0).forEach((s) => s.disconnect()));

function openSocket(opts = {}) {
  const socket = connect(url, { transports: ['websocket'], reconnection: false, ...opts });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function nextEvent(socket, event, match = () => true, ms = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No ${event} within ${ms}ms`)), ms);
    const handler = (payload) => {
      if (!match(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

async function login(username) {
  const res = await request(server).post('/api/staff/login').send({ restaurantSlug: 'bistro', username, pin: '482913' });
  assert.equal(res.status, 200);
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}

const openTable = async (fx) => {
  const res = await request(server).post(`/api/ops/tables/${fx.table._id}/open`).set('Cookie', await login('wendy'));
  assert.equal(res.status, 201);
};

const orderSoda = (fx, agent = request(server)) =>
  agent
    .post(`/api/t/${fx.table.qrToken}/orders`)
    .set('Idempotency-Key', randomUUID())
    .send({ items: [{ menuItemId: String(fx.soda._id), qty: 1 }], expectedTotalMinor: 9900 });

test('sockets without a valid login or table code are refused', async () => {
  await seedRestaurant();
  await assert.rejects(openSocket());
  await assert.rejects(openSocket({ auth: { qrToken: 'not-a-real-table' } }));
});

test('the kitchen sees a new order the moment it is placed', async () => {
  const fx = await seedRestaurant();
  await openTable(fx);
  const kitchen = await openSocket({ extraHeaders: { cookie: await login('kiran') } });
  const incoming = nextEvent(kitchen, 'order:update');
  await orderSoda(fx);
  const order = await incoming;
  assert.equal(order.status, 'placed');
  assert.equal(order.tableNumber, 1);
});

test('a guest already on the menu follows their order once the table opens', async () => {
  const fx = await seedRestaurant();
  const guest = await openSocket({ auth: { qrToken: fx.table.qrToken } });

  const opened = nextEvent(guest, 'session:update', (s) => s.status === 'open');
  await openTable(fx);
  await opened;

  const placed = await orderSoda(fx);
  const cooking = nextEvent(guest, 'order:update', (o) => o.status === 'cooking');
  const res = await request(server)
    .patch(`/api/ops/orders/${placed.body.id}/status`)
    .set('Cookie', await login('kiran'))
    .send({ status: 'cooking' });
  assert.equal(res.status, 200);
  await cooking;
});

test('status changes follow the rules: right role, right order, only once', async () => {
  const fx = await seedRestaurant();
  await openTable(fx);
  const placed = await orderSoda(fx);
  const path = `/api/ops/orders/${placed.body.id}/status`;
  const waiter = await login('wendy');
  const kitchen = await login('kiran');

  const waiterCooks = await request(server).patch(path).set('Cookie', waiter).send({ status: 'cooking' });
  const skipToReady = await request(server).patch(path).set('Cookie', kitchen).send({ status: 'served' });
  const start = await request(server).patch(path).set('Cookie', kitchen).send({ status: 'cooking' });
  const startAgain = await request(server).patch(path).set('Cookie', kitchen).send({ status: 'cooking' });

  assert.equal(waiterCooks.status, 403);
  assert.equal(skipToReady.status, 403); // serving is a floor job
  assert.equal(start.status, 200);
  assert.equal(startAgain.status, 409);
  assert.equal(startAgain.body.details.status, 'cooking');
});

test('sold-out reaches every open menu immediately', async () => {
  const fx = await seedRestaurant();
  const guest = await openSocket({ auth: { qrToken: fx.table.qrToken } });
  const update = nextEvent(guest, 'menu:availability');
  await request(server)
    .patch(`/api/ops/menu-items/${fx.soda._id}/availability`)
    .set('Cookie', await login('kiran'))
    .send({ available: false });
  assert.deepEqual(await update, { id: String(fx.soda._id), available: false });
});

test('logging out disconnects that person\'s live screens', async () => {
  await seedRestaurant();
  const cookie = await login('wendy');
  const socket = await openSocket({ extraHeaders: { cookie } });
  const dropped = new Promise((resolve) => socket.once('disconnect', resolve));
  await request(server).post('/api/staff/logout').set('Cookie', cookie);
  await dropped;
});

test('forgotten tables close themselves, but not while food is still being made', async () => {
  const fx = await seedRestaurant();
  await openTable(fx);
  await orderSoda(fx);
  const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
  await TableSession.updateMany({}, { lastActivityAt: fiveHoursAgo });

  assert.equal(await sweepIdleSessions(240), 0);

  await Order.updateMany({}, { status: 'served' });
  assert.equal(await sweepIdleSessions(240), 1);
  const session = await TableSession.findOne({ tableId: fx.table._id });
  assert.equal(session.status, 'closed');
  assert.equal(session.closedReason, 'idle');
});