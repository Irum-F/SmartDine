import http from 'node:http';
import mongoose from 'mongoose';
import { config } from './config.js';
import { logger } from './logger.js';
import { connectDb } from './db.js';
import { createApp } from './app.js';
import { initRealtime } from './realtime/index.js';
import { startSessionSweeper } from './jobs/sessionSweeper.js';

const app = createApp();
const server = http.createServer(app); // Socket.IO attaches to this server later
const realtime = await initRealtime(server);
const stopSweeper = startSessionSweeper();

server.listen(config.PORT, () => logger.info({ port: config.PORT }, 'API listening'));

// Keep retrying the database instead of crashing. /api/health stays up,
// and /api/ready reports "not ready" until the connection succeeds.
async function connectWithRetry() {
  for (let attempt = 1; ; attempt++) {
    try {
      await connectDb(config.MONGODB_URI, logger);
      return;
    } catch (err) {
      const delay = Math.min(attempt * 2000, 30000);
      logger.error({ err: err.message, attempt, retryInMs: delay }, 'MongoDB connection failed, retrying');
      await new Promise((resolve) => setTimeout(resolve, delay));
      stopSweeper();
      await realtime.close();
    }
  }
}

connectWithRetry();

function shutdown(signal) {
  logger.info({ signal }, 'Shutting down gracefully');

  server.close(async () => {
    await mongoose.connection.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref(); // force exit if it hangs
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);