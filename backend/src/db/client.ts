import postgres from 'postgres';

/**
 * Builds a Postgres client.
 *
 * A factory rather than a module-level singleton, so importing this file opens no
 * connection and reads no environment: the caller decides which database to use.
 */
export function createClient(connectionString: string) {
  return postgres(connectionString, {
    /**
     * Required, despite looking like tuning.
     *
     * Neon suspends compute only while no client holds a connection, and the free
     * plan allows 100 compute-hours a month — about 4.2 days of continuous uptime.
     * postgres.js keeps idle connections open by default, which would hold the
     * database awake and exhaust the allowance in roughly four days. Closing idle
     * connections lets compute scale to zero between visits.
     */
    idle_timeout: 20,
    /** Under Neon's free-plan connection ceiling for a single service. */
    max: 10,
    /**
     * Maps `created_at` <-> `createdAt` at the driver level, in both directions.
     * SQL text is untouched: queries are written in snake_case and read in camelCase.
     */
    transform: postgres.camel,
  });
}

/** The connection pool. Only the composition root and the migrator hold one. */
export type Sql = ReturnType<typeof createClient>;

/**
 * What a repository accepts: the pool or a transaction handle.
 *
 * `Sql` and `TransactionSql` both extend `ISql`, and neither is assignable to the
 * other. Taking their shared base lets one repository serve a standalone read and a
 * query inside a transaction without knowing which it has been given.
 */
export type Db = postgres.ISql;
