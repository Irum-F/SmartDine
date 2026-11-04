import http from 'node:http';
import mongoose from 'mongoose';
import { config } from './config.js';
import { logger } from './logger.js';
import { connectDb } from './db.js';
import { createApp } from './app.js';

const app = createApp();
const server = http.createServer(app); // Socket.IO attaches to this server later

await connectDb(config.MONGODB_URI, logger);

server.listen(config.PORT, () => logger.info({ port: config.PORT }, 'API listening'));

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