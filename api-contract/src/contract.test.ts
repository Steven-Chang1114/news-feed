import { describe, expect, it } from 'vitest';
import { articleSchema } from './article';
import { analysisOutputSchema, analysisPreviewSchema, listAnalysesQuerySchema } from './analysis';
import { listArticlesQuerySchema, searchResultSchema } from './search';
import { errorResponseSchema } from './error';

/**
 * These tests exist to pin the behaviour the rest of the system relies on —
 * coercion, defaults, and rejection — not to test that Zod works. Each case
 * corresponds to something that would otherwise fail at runtime somewhere less
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
    // Guards a real trap: `null` and `undefined` are not interchangeable here, so a
    // provider adapter must map missing fields to null explicitly.
    const { description, ...withoutDescription } = validArticle;
    expect(articleSchema.safeParse(withoutDescription).success).toBe(false);
  });
});

describe('searchResultSchema', () => {
  it('accepts an unanalyzed result with analysis explicitly null', () => {
    const parsed = searchResultSchema.parse({ ...validArticle, analysis: null });
    expect(parsed.analysis).toBeNull();
  });

  it('accepts an analyzed result carrying a preview', () => {
    const parsed = searchResultSchema.parse({
      ...validArticle,
      analysis: {
        id: '00000000-0000-4000-8000-000000000000',
        sentiment: 'negative',
        sentimentScore: -0.6,
        createdAt: '2026-07-26T10:00:00Z',
      },
    });
    expect(parsed.analysis?.sentiment).toBe('negative');
  });

  it('requires analysis to be present, so "not analyzed" cannot be confused with "not checked"', () => {
    // The field is mandatory-but-nullable on purpose: a response that simply omits
    // it is a server bug, and should fail loudly rather than render as "unanalyzed".
    expect(searchResultSchema.safeParse(validArticle).success).toBe(false);
  });

  it('does not carry a nested article, which would duplicate the one it is attached to', () => {
    expect('article' in analysisPreviewSchema.shape).toBe(false);
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
    rationale: 'Because of X.',
  };

  it('accepts a well-formed model response', () => {
    expect(analysisOutputSchema.parse(validOutput)).toEqual(validOutput);
  });

  it('rejects a sentiment label outside the closed set', () => {
    // The likeliest real failure: a model returning "mixed" or "very positive".
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
