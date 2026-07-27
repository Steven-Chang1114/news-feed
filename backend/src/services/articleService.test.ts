import type { Article } from '@news-feed/api-contract';
import { describe, expect, it, vi } from 'vitest';
import type { AnalysisRepository } from '../db/repositories/analysisRepository';
import type { NewsProvider } from '../providers/types';
import { createArticleService } from './articleService';

function article(url: string): Article {
  return {
    url,
    title: 'A headline',
    description: null,
    content: null,
    imageUrl: null,
    sourceName: 'Example News',
    publishedAt: null,
  };
}

const query = { q: 'climate', lang: 'en', limit: 10 };

function build(articles: Article[], analysed: Map<string, string>) {
  const news = { search: vi.fn(async () => articles) } as NewsProvider;
  const analysesRepo = { findIdsByUrls: vi.fn(async () => analysed) } as unknown as AnalysisRepository;
  return { service: createArticleService(news, analysesRepo), news, analysesRepo };
}

describe('createArticleService', () => {
  it('marks a result that is already in the feed', async () => {
    const { service } = build([article('https://a.test')], new Map([['https://a.test', 'analysis-1']]));

    const { articles } = await service.search(query);

    expect(articles[0]?.analysisId).toBe('analysis-1');
  });

  it('marks an unanalyzed result as null rather than omitting the field', async () => {
    const { service } = build([article('https://a.test')], new Map());

    const { articles } = await service.search(query);

    expect(articles[0]).toHaveProperty('analysisId', null);
  });

  it('resolves a whole page in one lookup rather than one per result', async () => {
    const urls = ['https://a.test', 'https://b.test', 'https://c.test'];
    const { service, analysesRepo } = build(urls.map(article), new Map());

    await service.search(query);

    expect(analysesRepo.findIdsByUrls).toHaveBeenCalledTimes(1);
    expect(analysesRepo.findIdsByUrls).toHaveBeenCalledWith(urls);
  });

  it('passes the parsed query straight to the provider', async () => {
    const { service, news } = build([], new Map());

    await service.search(query);

    expect(news.search).toHaveBeenCalledWith(query);
  });

  it('returns nothing when the provider finds nothing', async () => {
    const { service } = build([], new Map());

    expect((await service.search(query)).articles).toEqual([]);
  });
});
