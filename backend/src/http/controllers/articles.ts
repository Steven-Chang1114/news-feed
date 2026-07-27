import { listArticlesQuerySchema } from '@news-feed/api-contract';
import { Router } from 'express';
import { validationError } from '../../errors';
import type { ArticleService } from '../../services/articleService';

export function createArticlesController(articles: ArticleService): Router {
  const controller = Router();

  controller.get('/', async (req, res) => {
    const query = listArticlesQuerySchema.safeParse(req.query);
    if (!query.success) throw validationError(query.error.flatten().fieldErrors);

    res.json(await articles.search(query.data));
  });

  return controller;
}
