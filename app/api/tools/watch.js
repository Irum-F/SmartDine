// Live kitchen feed in your terminal: node tools/watch.js
import { io } from 'socket.io-client';

const base = process.env.SMARTDINE_URL ?? 'https://smartdine.lab.irum.dev';
const cookie = `sd_staff=${process.env.STAFF_TOKEN}`;
const orders = new Map();
const describe = (o) => o.items.map((i) => `${i.qty}× ${i.name}${i.variantName ? ` (${i.variantName})` : ''}`).join(', ');

function apply(o, quiet = false) {
  const known = orders.get(o.id);
  if (known && new Date(known.updatedAt) > new Date(o.updatedAt)) return; // stale, ignore
  orders.set(o.id, o);
  if (!quiet) console.log(`[live] table ${o.tableNumber} · ${o.status.padEnd(9)} · ${describe(o)}`);
}

async function resync() {
  const res = await fetch(`${base}/api/ops/kitchen/orders`, { headers: { cookie } });
  if (!res.ok) return console.error(`[sync] failed: ${res.status}`);
  const { orders: active, serverTime } = await res.json();
  const ids = new Set(active.map((o) => o.id));
  for (const o of active) apply(o, true);
  for (const [id, o] of orders) if (!ids.has(id) && new Date(o.updatedAt) < new Date(serverTime)) orders.delete(id);
  console.log(`[sync] ${orders.size} active orders`);
}

const socket = io(base, { transports: ['websocket'], extraHeaders: { cookie } });
socket.on('connect', () => { console.log(`[connected] ${socket.id}`); resync(); });
socket.on('disconnect', (reason) => console.log(`[disconnected] ${reason}`));
socket.on('connect_error', (err) => console.log(`[connect error] ${err.message}`));
socket.on('order:update', (o) => apply(o));
socket.on('request:update', (r) => console.log(`[request] table ${r.tableNumber} · ${r.type} · ${r.status}`));
socket.on('menu:availability', (m) => console.log(`[menu] ${m.id} available=${m.available}`));
socket.on('restaurant:busy', (b) => console.log(`[busy mode] ${b.busyMode}`));
setInterval(resync, 30_000);