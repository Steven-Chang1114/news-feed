import { listArticlesQuerySchema } from '@news-feed/api-contract';
import { Router } from 'express';
import { validationError } from '../../errors';
import type { ArticleService } from '../../services/articleService';

export function createArticleController(articleService: ArticleService): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const query = listArticlesQuerySchema.safeParse(req.query);
    if (!query.success) throw validationError(query.error.flatten().fieldErrors);

    res.json(await articleService.search(query.data));
  });

  return router;
}
