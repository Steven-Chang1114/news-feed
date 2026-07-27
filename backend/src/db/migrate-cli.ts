import { env } from '../config/env';
import { createClient } from './client';
import { runMigrations } from './migrate';

/**
 * `npm run db:migrate`.
 *
 * Separate from `migrate.ts` so importing `runMigrations` in a test never reads
 * `DATABASE_URL` or opens a connection — no entry-point detection required.
 */
const db = createClient(env.DATABASE_URL);

try {
  const applied = await runMigrations(db);
  console.log(
    applied.length
      ? `Applied ${applied.length} migration(s):\n  ${applied.join('\n  ')}`
      : 'Already up to date.',
  );
} finally {
  await db.end();
}
