import postgres from 'postgres';

/**
 * Builds a Postgres client.
 *
 * A factory, not a module-level singleton: importing this file must not open a
 * connection or read `DATABASE_URL` as a side effect, so tests can point at a
 * throwaway database and the composition root decides what the application uses.
 */
export function createClient(connectionString: string) {
  return postgres(connectionString, {
    /**
     * Load-bearing, despite looking like dead config.
     *
     * Neon suspends compute only while no client holds a connection. postgres.js
     * keeps idle connections open indefinitely by default, which would pin the
     * database awake around the clock. The free plan allows 100 compute-hours per
     * month — about 4.2 days of continuous uptime — so an always-open pool exhausts
     * the monthly allowance in roughly four days. Closing idle connections after 20s
     * lets compute scale to zero between visits.
     */
    idle_timeout: 20,
    /** Comfortably under Neon's free-plan connection ceiling for a single service. */
    max: 10,
    /**
     * Maps `created_at` <-> `createdAt` at the driver level, in both directions.
     * This is what removes the row-mapping boilerplate that usually makes raw SQL
     * grubby. SQL text is untouched — we write snake_case and read camelCase.
     */
    transform: postgres.camel,
  });
}

export type Sql = ReturnType<typeof createClient>;
