import { z } from 'zod';
import { articleSchema } from './article';

/* -------------------------------------------------------------------------- */
/* Sentiment                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A closed set, enforced at three layers because the value originates from a
 * language model:
 *
 *  1. the JSON Schema sent to the model prevents it emitting anything else;
 *  2. this schema rejects the value if it arrives anyway;
 *  3. a Postgres CHECK constraint binds writers that never run this code.
 */
export const SENTIMENTS = ['positive', 'neutral', 'negative'] as const;
export const sentimentSchema = z.enum(SENTIMENTS);
export type Sentiment = z.infer<typeof sentimentSchema>;

/* -------------------------------------------------------------------------- */
/* Model output                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What the analyzer returns: the boundary between what a model produced and what
 * is stored. It carries no identity or provenance — those are assigned when the
 * result is persisted.
 */
export const analysisOutputSchema = z.object({
  summary: z.string().min(1),
  sentiment: sentimentSchema,
  /**
   * -1 (most negative) through 1 (most positive). The label groups results; the
   * score preserves degree, so they can also be ranked by intensity.
   */
  sentimentScore: z.number().min(-1).max(1),
});
export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;

/* -------------------------------------------------------------------------- */
/* The stored resource                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A persisted analysis: the model's output, plus the identity, provenance and
 * article that make it a resource.
 *
 * Extends `analysisOutputSchema`, so the stored form inherits the constraints the
 * model output is held to.
 */
export const analysisResponseSchema = analysisOutputSchema.extend({
  id: z.string().uuid(),
  article: articleSchema,
  /** Which model and prompt produced this result. */
  model: z.string(),
  promptVersion: z.string(),
  createdAt: z.string().datetime({ offset: true }),
});
export type AnalysisResponse = z.infer<typeof analysisResponseSchema>;

/* -------------------------------------------------------------------------- */
/* POST /api/v1/analyses                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The client sends the whole article. The server does not re-fetch it: the news
 * provider allows 100 requests a day, and the client already holds the data.
 *
 * That makes the content being summarized client-supplied, so it is validated at
 * the edge like any other untrusted input.
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
   * Opaque keyset cursor. It marks a position in the ordering rather than a count,
   * so analyses added at the head cannot shift a reader onto a row they have seen.
   */
  cursor: z.string().optional(),
  sentiment: sentimentSchema.optional(),
});

/** What a client may send; a query string is text, so `limit` may be omitted. */
export type ListAnalysesQuery = z.input<typeof listAnalysesQuerySchema>;

/**
 * The query once validated: coerced, with defaults applied, which is what server
 * code holds. Both types are views of one schema, so adding a filter changes one
 * place.
 */
export type ParsedListAnalysesQuery = z.output<typeof listAnalysesQuerySchema>;

export const listAnalysesResponseSchema = z.object({
  analyses: z.array(analysisResponseSchema),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
});
export type ListAnalysesResponse = z.infer<typeof listAnalysesResponseSchema>;
