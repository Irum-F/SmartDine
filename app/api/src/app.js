import { guestRouter } from './routes/guest.js';
import { opsRouter } from './routes/ops.js';
import { OrderError } from './services/orders.js';
import cookieParser from 'cookie-parser';
import { staffRouter } from './routes/staff.js';
import express from 'express';
import pinoHttp from 'pino-http';
import { logger } from './logger.js';
import { healthRouter } from './routes/health.js';
import { adminRouter } from './routes/admin.js';
import { config } from './config.js';


export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Each proxy adds the address it received the request from. Trusting exactly the proxies we run
  // gives the visitor's real IP, so rate limits count people, not CloudFront servers.
  app.set('trust proxy', config.TRUST_PROXY_HOPS);  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger,
      // don't flood the logs with load balancer health checks
      autoLogging: { ignore: (req) => req.url.startsWith('/api/health') },
    })
  );

  app.use('/api', healthRouter);
  app.use('/api/staff', staffRouter);
  app.use('/api/t', guestRouter);
  app.use('/api/ops', opsRouter);
  app.use('/api/admin', adminRouter);

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof OrderError) {
      return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    }
    // Data the database refused (e.g. a value outside the schema): the client's fault, not a crash
    if (err.name === 'ValidationError' || err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid data', code: 'BAD_REQUEST', details: [{ path: [], message: err.message }] });
    }
    req.log.error({ err }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}