import { z } from 'zod';

/**
 * An article as it crosses the wire.
 *
 * Deliberately provider-agnostic: the GNews adapter maps into this shape rather than
 * this shape mirroring GNews. Swapping news providers is then a single-file change
 * instead of a change that ripples into the database and the UI.
 *
 * This type holds nothing about *our* state — no analysis, no ids of ours. It is
 * what a news provider knows, and nothing else. Anything we know about an article
 * is layered on top in a context that can actually populate it (see `search.ts`),
 * so a null field never has to mean "we didn't look".
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
