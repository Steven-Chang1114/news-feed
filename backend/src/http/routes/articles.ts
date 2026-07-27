import { listArticlesQuerySchema, type ListArticlesResponse } from '@news-feed/api-contract';
import { Router } from 'express';
import type { AnalysisRepository } from '../../db/repositories/analysisRepository';
import { validationError } from '../../errors';
import type { NewsProvider } from '../../providers/types';

export function createArticlesRouter(news: NewsProvider, analyses: AnalysisRepository): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const query = listArticlesQuerySchema.safeParse(req.query);
    if (!query.success) throw validationError(query.error.flatten().fieldErrors);

    const articles = await news.search(query.data);

    // One query for the whole page, so a result knows its own state without the
    // client asking per card.
    const analysisIds = await analyses.findIdsByUrls(articles.map((article) => article.url));

    const body: ListArticlesResponse = {
      articles: articles.map((article) => ({
        ...article,
        analysisId: analysisIds.get(article.url) ?? null,
      })),
    };
    res.json(body);
  });

  return router;
}
