import cookieParser from 'cookie-parser';
import { staffRouter } from './routes/staff.js';
import express from 'express';
import pinoHttp from 'pino-http';
import { logger } from './logger.js';
import { healthRouter } from './routes/health.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind the ALB: use the real client IP for rate limiting
  app.use(express.json({ limit: '100kb' }));
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

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    req.log.error({ err }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}