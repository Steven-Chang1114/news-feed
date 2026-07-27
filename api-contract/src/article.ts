import { z } from 'zod';

/**
 * An article as it crosses the wire.
 *
 * Provider-agnostic: the GNews adapter maps into this shape, so swapping news
 * providers is a single-file change.
 *
 * On the GNews free tier `content` is truncated to roughly 200 characters, so a
 * summary built from it describes a snippet rather than a full article. The UI says
 * so.
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

/* -------------------------------------------------------------------------- */
/* GET /api/v1/articles                                                        */
/* -------------------------------------------------------------------------- */

/** `q` is required: without a query there is no collection of news to return. */
export const listArticlesQuerySchema = z.object({
  q: z.string().trim().min(2, 'Search for at least 2 characters').max(100),
  lang: z.string().length(2).default('en'),
  /**
   * The news provider charges one request whatever the page size, so this caps how
   * much is shown rather than how much is spent.
   */
  limit: z.coerce.number().int().min(1).max(20).default(10),
});
/** What a client may send; a query string is text, so `limit` may be omitted. */
export type ListArticlesQuery = z.input<typeof listArticlesQuerySchema>;

/**
 * The query once validated: coerced, with defaults applied, which is what server
 * code holds. Both types are views of one schema.
 */
export type ParsedListArticlesQuery = z.output<typeof listArticlesQuerySchema>;

/**
 * An article plus whether it is already in the user's feed, so a card knows its own
 * state and can link straight to the stored analysis.
 *
 * `analysisId` lives here rather than on `articleSchema` because `Article` is the
 * provider shape and the news adapter has no database access. Confined to a search
 * result, `null` means "not analyzed"; on `Article` it could also mean "nobody
 * checked".
 */
export const searchResultSchema = articleSchema.extend({
  /** Non-null means this article has already been analyzed; the value links to it. */
  analysisId: z.string().uuid().nullable(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const listArticlesResponseSchema = z.object({
  results: z.array(searchResultSchema),
});
export type ListArticlesResponse = z.infer<typeof listArticlesResponseSchema>;
