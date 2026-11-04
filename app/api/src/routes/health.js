import { Router } from 'express';
import { dbReady } from '../db.js';

export const healthRouter = Router();

healthRouter.get('/health', (req, res) => res.json({ status: 'ok' }));

healthRouter.get('/ready', (req, res) =>
  dbReady() ? res.json({ status: 'ready' }) : res.status(503).json({ status: 'not ready' })
);