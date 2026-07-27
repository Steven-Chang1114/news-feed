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
     * postgres.js holds idle connections open indefinitely by default. The host
     * spins the service down after a quiet period, so releasing them means a
     * suspended service is not still occupying slots on the database.
     */
    idle_timeout: 20,
    /** Well inside the free plan's connection ceiling for a single service. */
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
