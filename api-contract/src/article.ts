import { z } from 'zod';

/**
 * An article as it crosses the wire.
 *
 * Deliberately provider-agnostic: the GNews adapter maps into this shape rather than
 * this shape mirroring GNews. Swapping news providers is then a single-file change
 * instead of a change that ripples into the database and the UI.
 *
 * `content` is nullable and, on the GNews free tier, truncated to roughly 200
 * characters. The UI says so, because a summary of a truncated snippet is a
 * different claim from a summary of an article.
 */
export const articleSchema = z.object({
  /** Canonical identity of an article. Deduplication everywhere keys on this. */
  url: z.string().url(),
  title: z.string().min(1),
  description: z.string().nullable(),
  content: z.string().nullable(),
  imageUrl: z.string().url().nullable(),
  sourceName: z.string().nullable(),
  publishedAt: z.string().datetime({ offset: true }).nullable(),
});
export type Article = z.infer<typeof articleSchema>;

/**
 * A search hit: an article plus whether it is already in the user's feed.
 *
 * Carrying `analysisId` on the article itself — rather than returning a separate
 * list of seen URLs — means each card knows its own state and can link straight to
 * the stored analysis. No client-side set building, and no N+1 request per result.
 */
export const searchResultSchema = articleSchema.extend({
  /** Non-null means this article has already been analyzed; the value links to it. */
  analysisId: z.string().uuid().nullable(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

/* -------------------------------------------------------------------------- */
/* GET /api/v1/articles                                                        */
/* -------------------------------------------------------------------------- */

/**
 * `q` is required. There is no such thing as "all news" to list here — without a
 * query there is no collection to return — so a missing `q` is a client error
 * rather than an unfiltered fetch.
 */
export const listArticlesQuerySchema = z.object({
  q: z.string().trim().min(2, 'Search for at least 2 characters').max(100),
  lang: z.string().length(2).default('en'),
  /**
   * Capped low deliberately. The free news tier allows 100 requests/day and charges
   * the same for any page size, so the limit exists to keep results scannable, not
   * to save quota.
   */
  limit: z.coerce.number().int().min(1).max(20).default(10),
});
/** Input type: pre-coercion, which is what a caller actually supplies. */
export type ListArticlesQuery = z.input<typeof listArticlesQuerySchema>;

export const listArticlesResponseSchema = z.object({
  articles: z.array(searchResultSchema),
});
export type ListArticlesResponse = z.infer<typeof listArticlesResponseSchema>;
