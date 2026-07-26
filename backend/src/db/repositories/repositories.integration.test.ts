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

  async function seedAnalysis(
    overrides: { url?: string; sentiment?: 'positive' | 'neutral' | 'negative'; summary?: string } = {},
  ) {
    const articleId = await articles.upsert(article(overrides.url ? { url: overrides.url } : {}), {
      provider: 'test',
    });
    return analyses.upsert({
      articleId,
      summary: overrides.summary ?? 'A summary',
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
      expect(await articles.upsert(article(), { provider: 'test' })).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('returns the same id for the same url, so analyzing twice cannot duplicate', async () => {
      const first = await articles.upsert(article(), { provider: 'test' });
      expect(await articles.upsert(article(), { provider: 'test' })).toBe(first);
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

  describe('analysisRepository.upsert', () => {
    it('stores an analysis with its article nested', async () => {
      const analysis = await seedAnalysis();
      expect(analysis.sentiment).toBe('positive');
      expect(analysis.article.title).toBe('A headline');
    });

    it('replaces the previous result when an article is analyzed again', async () => {
      const first = await seedAnalysis({ summary: 'Old summary' });
      const second = await seedAnalysis({ summary: 'New summary', sentiment: 'negative' });

      expect(second.id).toBe(first.id);
      expect(second.summary).toBe('New summary');
      expect(second.sentiment).toBe('negative');
    });

    it('never accumulates rows for the same article', async () => {
      await seedAnalysis({ summary: 'one' });
      await seedAnalysis({ summary: 'two' });
      await seedAnalysis({ summary: 'three' });

      const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM analyses`;
      expect(row?.count).toBe(1);
    });

    it('leaves created_at alone on replace, so the feed does not reorder mid-scroll', async () => {
      const first = await seedAnalysis({ summary: 'one' });
      const second = await seedAnalysis({ summary: 'two' });
      expect(second.createdAt).toBe(first.createdAt);
    });

    it('nests the article rather than exposing storage internals', async () => {
      const analysis = await seedAnalysis();
      expect(analysis.article.url).toBe(article().url);
      expect(analysis).not.toHaveProperty('articleId');
      expect(analysis).not.toHaveProperty('tokensIn');
    });

    it('refuses a sentiment outside the closed set, at the database', async () => {
      const articleId = await articles.upsert(article(), {});
      await expect(
        analyses.upsert({
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

  describe('analysisRepository.findById', () => {
    it('finds a stored analysis', async () => {
      const analysis = await seedAnalysis();
      expect((await analyses.findById(analysis.id))?.id).toBe(analysis.id);
    });

    it('returns null for an id that does not exist', async () => {
      expect(await analyses.findById('00000000-0000-4000-8000-000000000000')).toBeNull();
    });
  });

  describe('analysisRepository.findIdsByUrls', () => {
    it('maps only the urls that have been analyzed', async () => {
      const analysis = await seedAnalysis({ url: 'https://example.com/seen' });

      const found = await analyses.findIdsByUrls([
        'https://example.com/seen',
        'https://example.com/unseen',
      ]);

      expect(found.get('https://example.com/seen')).toBe(analysis.id);
      expect(found.has('https://example.com/unseen')).toBe(false);
    });

    it('resolves a whole page of search results in one call', async () => {
      for (let i = 0; i < 3; i++) await seedAnalysis({ url: `https://example.com/${i}` });

      const found = await analyses.findIdsByUrls([
        'https://example.com/0',
        'https://example.com/1',
        'https://example.com/2',
        'https://example.com/never-analyzed',
      ]);
      expect(found.size).toBe(3);
    });

    it('short-circuits on an empty list', async () => {
      expect((await analyses.findIdsByUrls([])).size).toBe(0);
    });

    it('ignores articles stored but never analyzed', async () => {
      await articles.upsert(article({ url: 'https://example.com/stored-only' }), {});
      expect((await analyses.findIdsByUrls(['https://example.com/stored-only'])).size).toBe(0);
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
});
