import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { parse as parseCookie } from 'cookie';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { Table } from '../models/table.js';
import { TableSession } from '../models/tableSession.js';
import { staffFromToken } from '../lib/staffSession.js';
import { setIo, rooms } from './events.js';

const STAFF_COOKIE = 'sd_staff';
const KITCHEN_ROLES = new Set(['owner', 'manager', 'kitchen']);
const FLOOR_ROLES = new Set(['owner', 'manager', 'waiter']);

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref());

export async function initRealtime(httpServer) {
  const io = new Server(httpServer, {
    serveClient: false,
    maxHttpBufferSize: 10_000, // clients never send data, so anything large is abuse
    // Browsers always send Origin. Refuse other sites; non-browser clients still need a valid cookie.
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      cb(null, !origin || !config.APP_ORIGIN || origin === config.APP_ORIGIN);
    },
  });

  let pub;
  let sub;
  if (config.REDIS_URL) {
    pub = createClient({ url: config.REDIS_URL, socket: { reconnectStrategy: (n) => Math.min(n * 200, 5000) } });
    sub = pub.duplicate();
    for (const [name, client] of [['pub', pub], ['sub', sub]]) {
      client.on('error', (err) => logger.warn({ client: name, err: err.message }, 'Redis error'));
      client.on('ready', () => logger.info({ client: name }, 'Redis ready'));
    }
    const ready = Promise.all([pub.connect(), sub.connect()]);
    ready.catch(() => {}); // keeps retrying in the background
    try {
      await Promise.race([ready, timeout(5000)]);
    } catch {
      logger.error('Redis unavailable at startup: live updates reach this container only until it reconnects');
    }
    io.adapter(createAdapter(pub, sub));
  } else {
    logger.warn('REDIS_URL not set: single-container mode');
  }

  // Who is connecting? Staff prove it with their login cookie, guests with the table's QR token.
  io.use(async (socket, next) => {
    try {
      const qrToken = socket.handshake.auth?.qrToken;
      if (typeof qrToken === 'string' && qrToken.length <= 100) {
        const table = await Table.findOne({ qrToken, active: true });
        if (!table) return next(new Error('UNAUTHORIZED'));
        const session = await TableSession.findOne({ tableId: table._id, status: 'open' });
        socket.data.guest = { restaurantId: String(table.restaurantId), tableId: String(table._id), sessionId: session && String(session._id) };
        return next();
      }

      const token = parseCookie(socket.handshake.headers.cookie ?? '')[STAFF_COOKIE];
      const result = await staffFromToken(token);
      if (!result || result.staff.mustChangePin) return next(new Error('UNAUTHORIZED'));
      const { staff, exp } = result;
      socket.data.staff = { id: String(staff._id), role: staff.role, restaurantId: String(staff.restaurantId), exp };
      next();
    } catch (err) {
      logger.warn({ err: err.message }, 'Socket auth failed');
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    const { staff, guest } = socket.data;
    if (staff) {
      socket.join(rooms.staff(staff.id));
      if (KITCHEN_ROLES.has(staff.role)) socket.join(rooms.kitchen(staff.restaurantId));
      if (FLOOR_ROLES.has(staff.role)) socket.join(rooms.floor(staff.restaurantId));
      // A socket must not outlive the login that opened it
      if (staff.exp) {
        const timer = setTimeout(() => socket.disconnect(true), Math.max(staff.exp * 1000 - Date.now(), 0));
        socket.on('disconnect', () => clearTimeout(timer));
      }
    } else {
      socket.join(rooms.menu(guest.restaurantId));
      socket.join(rooms.table(guest.tableId));
      if (guest.sessionId) socket.join(rooms.session(guest.sessionId));
    }
  });

  setIo(io);

  return {
    io,
    // On SIGTERM: drop sockets so clients reconnect to a healthy container, then close Redis
    async close() {
      io.disconnectSockets(true);
      setIo(null);
      await Promise.allSettled([pub?.quit(), sub?.quit()]);
    },
  };
}