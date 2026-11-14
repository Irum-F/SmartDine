import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  REDIS_URL: z.string().url().optional(),        // unset = single-container mode (tests, quick local runs)
  APP_ORIGIN: z.string().url().optional(),       // e.g. https://smartdine.lab.irum.dev
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(30).default(240),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;