import { z } from 'zod';
import { articleSchema } from './article';
import { analysisPreviewSchema } from './analysis';

/**
 * GET /api/v1/articles — search the news provider, annotated with our own state.
 *
 * This module exists so the dependency graph stays acyclic: `article` depends on
 * nothing, `analysis` depends on `article`, and this depends on both. That matters
 * more than it looks, because Zod schemas are built when the module is evaluated —
 * a circular import would hand `z.object()` an `undefined` schema and fail in a way
 * that points nowhere near the real cause.
 */

/**
 * An article from the provider, plus whether it is already in the user's feed.
 *
 * `analysis` is non-null only when we have one stored. Because this field lives
 * here rather than on `Article`, null unambiguously means "not analyzed" — never
 * "nobody checked". A bare `Article` has no such field to misread.
 *
 * A *preview* rather than the full analysis: the card needs an id to link with and
 * a sentiment to show, and embedding the whole thing would duplicate the article
 * that is already right here.
 */
export const searchResultSchema = articleSchema.extend({
  analysis: analysisPreviewSchema.nullable(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

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
