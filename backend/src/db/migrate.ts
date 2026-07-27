import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from './client';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Arbitrary constant identifying this application's migration lock. Two processes
 * booting at once — which a rolling deploy does by design — would otherwise both
 * try to apply the same migration.
 */
const MIGRATION_LOCK_KEY = 947_120_385;

/**
 * Applies every `.sql` file in `migrations/` that has not run yet, in filename
 * order, recording each in `schema_migrations`.
 *
 * Migrations are numbered and immutable: fixing a mistake means adding `002_…`,
 * never editing `001_…`, because an already-applied file will never run again.
 *
 * Each migration runs in a transaction together with its bookkeeping insert, so a
 * failure cannot leave a half-applied schema recorded as complete. Postgres has
 * transactional DDL, which is exactly what makes that guarantee possible.
 */
export async function runMigrations(db: Sql): Promise<string[]> {
  await db`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  // Serialises concurrent migrators. Released below, and automatically if the
  // connection dies mid-run.
  await db`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;

  const applied: string[] = [];
  try {
    const rows = await db<{ filename: string }[]>`SELECT filename FROM schema_migrations`;
    const done = new Set(rows.map((row) => row.filename));

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (done.has(file)) continue;

      const statements = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      await db.begin(async (tx) => {
        // `unsafe` because a migration is a static local file, not user input, and
        // it holds multiple statements that must not be parameterised.
        await tx.unsafe(statements);
        await tx`INSERT INTO schema_migrations (filename) VALUES (${file})`;
      });

      applied.push(file);
    }
  } finally {
    await db`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
  }

  return applied;
}

/** Drops every table this application owns. Used by the integration suite. */
export async function resetSchema(db: Sql): Promise<void> {
  await db`DROP TABLE IF EXISTS analyses, articles, schema_migrations CASCADE`;
}
