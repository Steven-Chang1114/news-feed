import type { Sentiment } from '@news-feed/api-contract';

/**
 * Row shapes, as returned by the driver after `transform: postgres.camel`.
 *
 * These are storage's view and stay inside `db/`. Mapping them to contract types is
 * the repository's job; a `Row` reaching a route handler means internals such as
 * token counts and raw provider payloads are on their way to a client.
 *
 * A row type is a claim, not a compile-time check — rename a column and TypeScript
 * will not notice. The integration test catches that by executing every query
 * against a real migrated database.
 */

/**
 * An analysis joined to its article: the projection every read uses.
 *
 * Flat, because that is what SQL returns; the repository reshapes it into the
 * nested contract type. Dates arrive as `Date` rather than the ISO strings the wire
 * carries.
 */
export interface AnalysisWithArticleRow {
  id: string;
  summary: string;
  sentiment: Sentiment;
  sentimentScore: number;
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
