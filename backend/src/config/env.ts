import { z } from 'zod';

/**
 * Environment is validated once, at boot, and the process refuses to start if it is
 * wrong. A misconfigured deploy should fail loudly in seconds, not silently at 3am
 * when the first request touches an undefined value.
 *
 * Only variables the code reads are listed, so `db:migrate` never fails for want of
 * an OpenAI key it will not use.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
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
