import { z } from 'zod';
import { articleSchema } from './article';

/* -------------------------------------------------------------------------- */
/* Sentiment                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A closed set, enforced at three layers:
 *
 *  1. the JSON Schema sent to the model, so it cannot emit anything else;
 *  2. this Zod schema, which rejects it if the model somehow does;
 *  3. a Postgres CHECK constraint, so an invalid value cannot be persisted at all.
 *
 * Three layers looks redundant until you remember the input is a probabilistic
 * system. Each layer fails differently: (1) prevents, (2) reports, (3) guarantees.
 */
export const SENTIMENTS = ['positive', 'neutral', 'negative'] as const;
export const sentimentSchema = z.enum(SENTIMENTS);
export type Sentiment = z.infer<typeof sentimentSchema>;

/* -------------------------------------------------------------------------- */
/* Model output                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What the analyzer must return. This is the boundary between "the model said
 * something" and "we are willing to store it".
 *
 * Kept separate from `analysisSchema` because it holds no identity and no
 * provenance — it is a value produced by a model, not a resource that exists.
 */
export const analysisOutputSchema = z.object({
  summary: z.string().min(1),
  sentiment: sentimentSchema,
  /**
   * -1 (most negative) through 1 (most positive). The label alone collapses
   * "mildly negative" and "catastrophic" into one bucket; the score keeps the
   * degree, so the feed can rank by intensity rather than just group by label.
   */
  sentimentScore: z.number().min(-1).max(1),
  /** One line on *why*. Turns an opaque label into a claim a user can check or dispute. */
  rationale: z.string().min(1),
});
export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;

/* -------------------------------------------------------------------------- */
/* The stored resource                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A persisted analysis: the model's output, plus the identity, provenance and
 * article that make it a resource rather than a value.
 *
 * Extends `analysisOutputSchema` rather than restating its four fields, so the
 * relationship is stated once and the stored form inherits the same constraints
 * the model output is held to.
 */
export const analysisSchema = analysisOutputSchema.extend({
  id: z.string().uuid(),
  article: articleSchema,
  /** Provenance: which model and prompt produced this result. */
  model: z.string(),
  promptVersion: z.string(),
  createdAt: z.string().datetime({ offset: true }),
});
export type Analysis = z.infer<typeof analysisSchema>;

/* -------------------------------------------------------------------------- */
/* POST /api/v1/analyses                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The client sends the whole article, not just a URL.
 *
 * Posting a URL and re-fetching server-side would spend a second request from a
 * 100/day budget to retrieve data the client is already holding. The tradeoff is
 * that the client supplies the content we summarize, so it is validated at the edge
 * like any other untrusted input.
 */
export const createAnalysisRequestSchema = z.object({
  article: articleSchema,
});
export type CreateAnalysisRequest = z.infer<typeof createAnalysisRequestSchema>;

/* -------------------------------------------------------------------------- */
/* GET /api/v1/analyses                                                        */
/* -------------------------------------------------------------------------- */

export const listAnalysesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /**
   * Opaque keyset cursor. Chosen over OFFSET because the feed is ordered newest
   * first and grows at the head: with OFFSET, analyzing an article while paginating
   * shifts every subsequent row and the reader silently sees a duplicate.
   */
  cursor: z.string().optional(),
  sentiment: sentimentSchema.optional(),
});
export type ListAnalysesQuery = z.input<typeof listAnalysesQuerySchema>;

export const listAnalysesResponseSchema = z.object({
  analyses: z.array(analysisSchema),
  /** Null means this is the last page. */
  nextCursor: z.string().nullable(),
});
export type ListAnalysesResponse = z.infer<typeof listAnalysesResponseSchema>;
