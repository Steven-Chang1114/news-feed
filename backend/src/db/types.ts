import type { Sentiment } from '@news-feed/api-contract';

/**
 * Row shapes, as returned by the driver after `transform: postgres.camel`.
 *
 * These are storage's view and stay inside `db/`. A repository's job is to map them
 * to the contract types; a `Row` appearing in a route handler means that boundary
 * has leaked and internals — token counts, raw provider payloads — are on their way
 * to a client.
 *
 * A row type is a claim, not a compile-time check: rename a column and TypeScript
 * will not notice. The integration test exists to catch exactly that, by executing
 * every query against a real migrated database.
 *
 * Only shapes a query actually returns are declared here. Mirroring every table
 * would produce types nothing reads, and an unread type cannot be wrong in a way
 * anyone notices.
 */

/**
 * An analysis joined to its article — the projection every read uses.
 *
 * Flat, because that is what SQL returns; the repository reshapes it into the
 * nested contract type. Dates arrive as `Date`, not the ISO strings the wire uses,
 * which is one concrete reason storage types cannot simply be the contract types.
 */
export interface AnalysisWithArticleRow {
  id: string;
  summary: string;
  sentiment: Sentiment;
  sentimentScore: number;
  rationale: string;
  model: string;
  promptVersion: string;
  createdAt: Date;

  url: string;
  title: string;
  description: string | null;
  content: string | null;
  imageUrl: string | null;
  sourceName: string | null;
  publishedAt: Date | null;
}
