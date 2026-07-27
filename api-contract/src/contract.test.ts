import { describe, expect, it } from 'vitest';
import { articleSchema, listArticlesQuerySchema } from './article';
import { analysisOutputSchema, listAnalysesQuerySchema } from './analysis';
import { errorResponseSchema } from './error';

/**
 * Pins the coercion, defaults and rejection the rest of the system relies on. Each
 * case corresponds to something that would otherwise fail at runtime somewhere less
 * obvious.
 */

const validArticle = {
  url: 'https://example.com/a',
  title: 'Title',
  description: null,
  content: null,
  imageUrl: null,
  sourceName: null,
  publishedAt: '2026-07-26T10:00:00Z',
};

describe('articleSchema', () => {
  it('accepts a fully null-optional article', () => {
    expect(articleSchema.parse(validArticle)).toEqual(validArticle);
  });

  it('rejects a non-URL url, since url is the deduplication key', () => {
    const result = articleSchema.safeParse({ ...validArticle, url: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty title', () => {
    expect(articleSchema.safeParse({ ...validArticle, title: '' }).success).toBe(false);
  });

  it('treats a missing nullable field as absent rather than null', () => {
    // `null` and `undefined` are not interchangeable here, so a provider adapter
    // must map missing fields to null explicitly.
    const { description, ...withoutDescription } = validArticle;
    expect(articleSchema.safeParse(withoutDescription).success).toBe(false);
  });
});

describe('listArticlesQuerySchema', () => {
  it('coerces limit from a string, because query params are always strings', () => {
    const parsed = listArticlesQuerySchema.parse({ q: 'climate', limit: '5' });
    expect(parsed.limit).toBe(5);
  });

  it('applies defaults when lang and limit are omitted', () => {
    const parsed = listArticlesQuerySchema.parse({ q: 'climate' });
    expect(parsed).toMatchObject({ lang: 'en', limit: 10 });
  });

  it('trims q before length-checking it', () => {
    expect(listArticlesQuerySchema.parse({ q: '  climate  ' }).q).toBe('climate');
  });

  it('rejects a q that is too short to be a useful search', () => {
    expect(listArticlesQuerySchema.safeParse({ q: 'a' }).success).toBe(false);
  });

  it('rejects a limit above the cap instead of silently clamping', () => {
    expect(listArticlesQuerySchema.safeParse({ q: 'climate', limit: '500' }).success).toBe(false);
  });
});

describe('listAnalysesQuerySchema', () => {
  it('defaults limit and leaves cursor absent on a first page request', () => {
    const parsed = listAnalysesQuerySchema.parse({});
    expect(parsed.limit).toBe(20);
    expect(parsed.cursor).toBeUndefined();
  });

  it('rejects a sentiment filter outside the closed set', () => {
    expect(listAnalysesQuerySchema.safeParse({ sentiment: 'angry' }).success).toBe(false);
  });
});

describe('analysisOutputSchema', () => {
  // This is the gate between "the model returned something" and "we store it".
  const validOutput = {
    summary: 'A summary.',
    sentiment: 'positive',
    sentimentScore: 0.8,
    };

  it('accepts a well-formed model response', () => {
    expect(analysisOutputSchema.parse(validOutput)).toEqual(validOutput);
  });

  it('rejects a sentiment label outside the closed set', () => {
    // A model returning "mixed" or "very positive" is the likeliest failure here.
    expect(analysisOutputSchema.safeParse({ ...validOutput, sentiment: 'mixed' }).success).toBe(
      false,
    );
  });

  it('rejects a score outside -1..1', () => {
    expect(analysisOutputSchema.safeParse({ ...validOutput, sentimentScore: 5 }).success).toBe(
      false,
    );
  });

  it('rejects an empty summary, which is a silent failure rather than an error', () => {
    expect(analysisOutputSchema.safeParse({ ...validOutput, summary: '' }).success).toBe(false);
  });
});

describe('errorResponseSchema', () => {
  it('requires a requestId so any client-reported failure is traceable in logs', () => {
    const withoutRequestId = { error: { code: 'NOT_FOUND', message: 'Missing' } };
    expect(errorResponseSchema.safeParse(withoutRequestId).success).toBe(false);
  });

  it('accepts an error without optional details', () => {
    const minimal = { error: { code: 'NOT_FOUND', message: 'Missing', requestId: 'req-1' } };
    expect(errorResponseSchema.safeParse(minimal).success).toBe(true);
  });
});
