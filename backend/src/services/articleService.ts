import type { ListArticlesResponse, ParsedListArticlesQuery } from '@news-feed/api-contract';
import type { AnalysisRepository } from '../db/repositories/analysisRepository';
import type { NewsProvider } from '../providers/types';

export interface ArticleService {
  search(query: ParsedListArticlesQuery): Promise<ListArticlesResponse>;
}

export function createArticleService(
  news: NewsProvider,
  analysesRepo: AnalysisRepository,
): ArticleService {
  return {
    async search(query) {
      const articles = await news.search(query);

      // One query for the whole page, so a result knows its own state without the
      // client asking per card.
      const analysisIds = await analysesRepo.findIdsByUrls(articles.map((article) => article.url));

      return {
        articles: articles.map((article) => ({
          ...article,
          analysisId: analysisIds.get(article.url) ?? null,
        })),
      };
    },
  };
}
