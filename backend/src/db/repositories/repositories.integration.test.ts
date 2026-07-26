import type { Article } from '@news-feed/api-contract';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '../client';
import { resetSchema, runMigrations } from '../migrate';
import { createAnalysisRepository, type AnalysisRepository } from './analysisRepository';
import { createArticleRepository, type ArticleRepository } from './articleRepository';

/**
 * The safety net for hand-written SQL.
 *
 * Row types are claims, not compile-time checks — rename a column and TypeScript
 * stays happy. This suite executes every repository query against a real migrated
 * database, so a schema/type mismatch fails here instead of in production.
 *
 * It requires TEST_DATABASE_URL rather than reusing DATABASE_URL, deliberately: this
 * file drops and recreates every table, and pointing it at a production connection
 * string by accident should be impossible rather than merely unlikely.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const MODEL = 'gpt-4.1-nano';
const PROMPT_VERSION = 'v1';

function article(overrides: Partial<Article> = {}): Article {
  return {
    url: 'https://example.com/a',
    title: 'A headline',
    description: 'A description',
    content: 'Some content',
    imageUrl: 'https://example.com/a.jpg',
    sourceName: 'Example News',
    publishedAt: '2026-07-26T10:00:00.000Z',
    ...overrides,
  };
}

describe.skipIf(!TEST_DATABASE_URL)('repositories (integration)', () => {
  let sql: Sql;
  let articles: ArticleRepository;
  let analyses: AnalysisRepository;

  beforeAll(async () => {
    sql = createClient(TEST_DATABASE_URL!);
    await resetSchema(sql);
    await runMigrations(sql);
    articles = createArticleRepository(sql);
    analyses = createAnalysisRepository(sql);
  });

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    // Both tables named explicitly rather than `articles CASCADE`: same effect,
    // without Postgres emitting a NOTICE on every single test.
    await sql`TRUNCATE analyses, articles`;
  });

  async function seedAnalysis(overrides: { url?: string; sentiment?: 'positive' | 'neutral' | 'negative' } = {}) {
    const input = article(overrides.url ? { url: overrides.url } : {});
    const articleId = await articles.upsert(input, { provider: 'test' });
    return analyses.create({
      articleId,
      summary: 'A summary',
      sentiment: overrides.sentiment ?? 'positive',
      sentimentScore: 0.5,
      rationale: 'Because.',
      model: MODEL,
      promptVersion: PROMPT_VERSION,
      tokensIn: 100,
      tokensOut: 50,
      latencyMs: 250,
    });
  }

  describe('articleRepository.upsert', () => {
    it('inserts a new article and returns its id', async () => {
      const id = await articles.upsert(article(), { provider: 'test' });
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('returns the same id for the same url, so analyzing twice cannot duplicate', async () => {
      const first = await articles.upsert(article(), { provider: 'test' });
      const second = await articles.upsert(article(), { provider: 'test' });
      expect(second).toBe(first);
    });

    it('refreshes metadata when a provider has corrected it', async () => {
      await articles.upsert(article(), { provider: 'test' });
      await articles.upsert(article({ title: 'A corrected headline' }), { provider: 'test' });

      const [row] = await sql<{ title: string }[]>`SELECT title FROM articles WHERE url = ${article().url}`;
      expect(row?.title).toBe('A corrected headline');
    });

    it('persists null optional fields without turning them into empty strings', async () => {
      await articles.upsert(article({ description: null, imageUrl: null, publishedAt: null }), {});
      const [row] = await sql<{ description: string | null; publishedAt: Date | null }[]>`
        SELECT description, published_at FROM articles WHERE url = ${article().url}
      `;
      expect(row?.description).toBeNull();
      expect(row?.publishedAt).toBeNull();
    });
  });

  describe('analysisRepository.create', () => {
    it('creates an analysis and reports it as newly created', async () => {
      const { analysis, created } = await seedAnalysis();
      expect(created).toBe(true);
      expect(analysis.sentiment).toBe('positive');
      expect(analysis.article.title).toBe('A headline');
    });

    it('returns the existing row instead of a duplicate when the same work is requested twice', async () => {
      const first = await seedAnalysis();
      const second = await seedAnalysis();

      expect(second.created).toBe(false);
      expect(second.analysis.id).toBe(first.analysis.id);

      const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM analyses`;
      expect(row?.count).toBe(1);
    });

    it('nests the article rather than exposing the foreign key', async () => {
      const { analysis } = await seedAnalysis();
      expect(analysis.article.url).toBe(article().url);
      expect(analysis).not.toHaveProperty('articleId');
      expect(analysis).not.toHaveProperty('tokensIn');
    });

    it('refuses a sentiment outside the closed set, at the database', async () => {
      const articleId = await articles.upsert(article(), {});
      await expect(
        analyses.create({
          articleId,
          summary: 's',
          // The exact failure a language model produces: a plausible label we never allowed.
          sentiment: 'mixed' as never,
          sentimentScore: 0,
          rationale: 'r',
          model: MODEL,
          promptVersion: PROMPT_VERSION,
          tokensIn: null,
          tokensOut: null,
          latencyMs: null,
        }),
      ).rejects.toThrow();
    });
  });

  describe('analysisRepository.findById / findByArticleUrl', () => {
    it('finds a stored analysis by id', async () => {
      const { analysis } = await seedAnalysis();
      expect((await analyses.findById(analysis.id))?.id).toBe(analysis.id);
    });

    it('returns null for an id that does not exist', async () => {
      expect(await analyses.findById('00000000-0000-4000-8000-000000000000')).toBeNull();
    });

    it('finds by url scoped to model and prompt version', async () => {
      const { analysis } = await seedAnalysis();
      expect((await analyses.findByArticleUrl(article().url, MODEL, PROMPT_VERSION))?.id).toBe(analysis.id);
    });

    it('does not match a different prompt version, so a new prompt re-analyzes', async () => {
      await seedAnalysis();
      expect(await analyses.findByArticleUrl(article().url, MODEL, 'v2')).toBeNull();
    });
  });

  describe('analysisRepository.list', () => {
    beforeEach(async () => {
      for (let i = 0; i < 5; i++) {
        await seedAnalysis({
          url: `https://example.com/${i}`,
          sentiment: i % 2 === 0 ? 'positive' : 'negative',
        });
      }
    });

    it('returns newest first', async () => {
      const { analyses: page } = await analyses.list({ limit: 10 });
      const timestamps = page.map((a) => a.createdAt);
      expect([...timestamps].sort().reverse()).toEqual(timestamps);
    });

    it('returns no cursor when the last page fits', async () => {
      const { analyses: page, nextCursor } = await analyses.list({ limit: 10 });
      expect(page).toHaveLength(5);
      expect(nextCursor).toBeNull();
    });

    it('pages through every row exactly once without overlap', async () => {
      const seen: string[] = [];
      let cursor: string | undefined;

      do {
        const page = await analyses.list({ limit: 2, cursor });
        seen.push(...page.analyses.map((a) => a.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
    });

    it('filters by sentiment', async () => {
      const { analyses: page } = await analyses.list({ limit: 10, sentiment: 'negative' });
      expect(page).toHaveLength(2);
      expect(page.every((a) => a.sentiment === 'negative')).toBe(true);
    });

    it('combines a sentiment filter with paging', async () => {
      const first = await analyses.list({ limit: 1, sentiment: 'positive' });
      expect(first.analyses).toHaveLength(1);
      expect(first.nextCursor).not.toBeNull();

      const second = await analyses.list({ limit: 10, sentiment: 'positive', cursor: first.nextCursor! });
      expect(second.analyses).toHaveLength(2);
      expect(second.analyses.map((a) => a.id)).not.toContain(first.analyses[0]!.id);
    });

    it('treats an unparseable cursor as no cursor rather than failing', async () => {
      const { analyses: page } = await analyses.list({ limit: 10, cursor: 'garbage!!' });
      expect(page).toHaveLength(5);
    });
  });

  describe('analysisRepository.breakdown', () => {
    it('counts across the whole feed, not a page', async () => {
      for (let i = 0; i < 3; i++) {
        await seedAnalysis({ url: `https://example.com/p${i}`, sentiment: 'positive' });
      }
      await seedAnalysis({ url: 'https://example.com/n0', sentiment: 'negative' });

      expect(await analyses.breakdown()).toEqual({ positive: 3, neutral: 0, negative: 1, total: 4 });
    });

    it('returns zeroes rather than an empty object on an empty feed', async () => {
      expect(await analyses.breakdown()).toEqual({ positive: 0, neutral: 0, negative: 0, total: 0 });
    });

    it('returns numbers, not bigint strings', async () => {
      await seedAnalysis();
      expect(typeof (await analyses.breakdown()).total).toBe('number');
    });
  });

  describe('analysisRepository.findAnalysisIdsByUrls', () => {
    it('maps only the urls that have been analyzed', async () => {
      const { analysis } = await seedAnalysis({ url: 'https://example.com/seen' });

      const found = await analyses.findAnalysisIdsByUrls([
        'https://example.com/seen',
        'https://example.com/unseen',
      ]);

      expect(found.get('https://example.com/seen')).toBe(analysis.id);
      expect(found.has('https://example.com/unseen')).toBe(false);
    });

    it('short-circuits on an empty list', async () => {
      expect((await analyses.findAnalysisIdsByUrls([])).size).toBe(0);
    });

    it('returns the most recent analysis when an article has several', async () => {
      const articleId = await articles.upsert(article({ url: 'https://example.com/multi' }), {});
      const base = {
        articleId,
        summary: 's',
        sentiment: 'positive' as const,
        sentimentScore: 0.1,
        rationale: 'r',
        model: MODEL,
        tokensIn: null,
        tokensOut: null,
        latencyMs: null,
      };
      await analyses.create({ ...base, promptVersion: 'v1' });
      const newer = await analyses.create({ ...base, promptVersion: 'v2' });

      const found = await analyses.findAnalysisIdsByUrls(['https://example.com/multi']);
      expect(found.get('https://example.com/multi')).toBe(newer.analysis.id);
    });
  });
});
