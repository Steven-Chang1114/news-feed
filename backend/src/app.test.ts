import type { AnalysisResponse, Article } from '@news-feed/api-contract';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { rateLimitedError, upstreamError } from './errors';
import type { AnalysisService } from './services/analysisService';
import type { ArticleService } from './services/articleService';

const article: Article = {
  url: 'https://example.com/a',
  title: 'A headline',
  description: 'A description',
  content: 'Some content',
  imageUrl: null,
  sourceName: 'Example News',
  publishedAt: '2026-07-26T10:00:00.000Z',
};

const analysis: AnalysisResponse = {
  id: '11111111-1111-4111-8111-111111111111',
  article,
  summary: 'A summary.',
  sentiment: 'positive',
  sentimentScore: 0.5,
  model: 'gpt-4.1-nano',
  promptVersion: 'v1',
  createdAt: '2026-07-26T10:00:00.000Z',
};

function buildApp(
  overrides: { articleService?: Partial<ArticleService>; analysisService?: Partial<AnalysisService> } = {},
) {
  const articleService = {
    search: vi.fn(async () => ({ results: [{ ...article, analysisId: null }] })),
    ...overrides.articleService,
  } as ArticleService;

  const analysisService = {
    analyze: vi.fn(async () => analysis),
    list: vi.fn(async () => ({ analyses: [analysis], nextCursor: null })),
    delete: vi.fn(async () => true),
    ...overrides.analysisService,
  } as AnalysisService;

  return { app: createApp({ articleService, analysisService, corsOrigin: '*' }), articleService, analysisService };
}

describe('GET /health', () => {
  it('answers without touching any dependency', async () => {
    const response = await request(buildApp().app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});

describe('GET /api/v1/articles', () => {
  it('returns what the service produced', async () => {
    const response = await request(buildApp().app).get('/api/v1/articles?q=climate');

    expect(response.status).toBe(200);
    expect(response.body.results[0]).toMatchObject({ url: article.url, analysisId: null });
  });

  it('hands the service a coerced and defaulted query', async () => {
    const { app, articleService } = buildApp();
    await request(app).get('/api/v1/articles?q=climate&limit=5');

    expect(articleService.search).toHaveBeenCalledWith({ q: 'climate', lang: 'en', limit: 5 });
  });

  it('rejects a missing query with 400 and field-level details', async () => {
    const response = await request(buildApp().app).get('/api/v1/articles');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toHaveProperty('q');
  });

  it('rejects a limit above the cap rather than silently clamping', async () => {
    expect((await request(buildApp().app).get('/api/v1/articles?q=climate&limit=500')).status).toBe(400);
  });

  it('surfaces a provider quota failure as 429', async () => {
    const { app } = buildApp({
      articleService: {
        search: vi.fn(async () => {
          throw rateLimitedError('The news provider daily request limit has been reached');
        }),
      },
    });

    const response = await request(app).get('/api/v1/articles?q=climate');

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('RATE_LIMITED');
  });

  it('surfaces a provider outage as 502', async () => {
    const { app } = buildApp({
      articleService: {
        search: vi.fn(async () => {
          throw upstreamError('The news provider did not respond');
        }),
      },
    });

    expect((await request(app).get('/api/v1/articles?q=climate')).status).toBe(502);
  });
});

describe('POST /api/v1/analyses', () => {
  it('creates an analysis and returns it', async () => {
    const response = await request(buildApp().app).post('/api/v1/analyses').send({ article });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(analysis);
  });

  it('rejects a body with no article', async () => {
    const response = await request(buildApp().app).post('/api/v1/analyses').send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an article whose url is not a url', async () => {
    const response = await request(buildApp().app)
      .post('/api/v1/analyses')
      .send({ article: { ...article, url: 'not-a-url' } });

    expect(response.status).toBe(400);
  });

  it('surfaces a model failure as 502 rather than a partial result', async () => {
    const { app } = buildApp({
      analysisService: {
        analyze: vi.fn(async () => {
          throw upstreamError('The analysis provider returned an unusable analysis');
        }),
      },
    });

    const response = await request(app).post('/api/v1/analyses').send({ article });

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('UPSTREAM_ERROR');
  });
});

describe('GET /api/v1/analyses', () => {
  it('returns the feed', async () => {
    const response = await request(buildApp().app).get('/api/v1/analyses');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ analyses: [analysis], nextCursor: null });
  });

  it('applies defaults when no parameters are given', async () => {
    const { app, analysisService } = buildApp();
    await request(app).get('/api/v1/analyses');

    expect(analysisService.list).toHaveBeenCalledWith({ limit: 20 });
  });

  it('passes the sentiment filter and cursor through', async () => {
    const { app, analysisService } = buildApp();
    await request(app).get('/api/v1/analyses?sentiment=negative&cursor=abc&limit=5');

    expect(analysisService.list).toHaveBeenCalledWith({ limit: 5, sentiment: 'negative', cursor: 'abc' });
  });

  it('rejects a sentiment outside the closed set', async () => {
    expect((await request(buildApp().app).get('/api/v1/analyses?sentiment=angry')).status).toBe(400);
  });
});

describe('DELETE /api/v1/analyses/:id', () => {
  it('removes an analysis and returns no content', async () => {
    const response = await request(buildApp().app).delete(`/api/v1/analyses/${analysis.id}`);

    expect(response.status).toBe(204);
    expect(response.body).toEqual({});
  });

  it('returns 404 when the analysis was already gone', async () => {
    const { app } = buildApp({ analysisService: { delete: vi.fn(async () => false) } });

    const response = await request(app).delete(`/api/v1/analyses/${analysis.id}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for a malformed id without reaching the service', async () => {
    const { app, analysisService } = buildApp();

    expect((await request(app).delete('/api/v1/analyses/not-a-uuid')).status).toBe(404);
    expect(analysisService.delete).not.toHaveBeenCalled();
  });
});

describe('error envelope', () => {
  it('carries a request id that matches the response header', async () => {
    const response = await request(buildApp().app).get('/api/v1/articles');

    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
    expect(response.body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('answers an unknown path with the same envelope, not Express HTML', async () => {
    const response = await request(buildApp().app).get('/api/v1/nope');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('hides internals when a dependency throws something unexpected', async () => {
    const { app } = buildApp({
      articleService: {
        search: vi.fn(async () => {
          throw new Error('connection string postgres://user:hunter2@host/db');
        }),
      },
    });

    const response = await request(app).get('/api/v1/articles?q=climate');

    expect(response.status).toBe(500);
    expect(response.body.error.message).toBe('Something went wrong');
    expect(JSON.stringify(response.body)).not.toContain('hunter2');
  });
});
