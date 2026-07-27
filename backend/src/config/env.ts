import { z } from 'zod';

/**
 * Environment is validated once, at boot, and the process refuses to start if it is
 * wrong. A misconfigured deploy should fail loudly in seconds, not silently at 3am
 * when the first request touches an undefined value.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  /** Only used in development; in production the SPA is served by this process. */
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  GNEWS_API_KEY: z.string().min(1, 'GNEWS_API_KEY is required — free key at https://gnews.io'),

  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_MODEL: z.string().default('gpt-4.1-nano'),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    // console rather than a logger: the logger would itself depend on config.
    console.error(`Invalid environment configuration:\n${issues}\n`);
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();
