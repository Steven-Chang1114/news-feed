import cors from 'cors';
import express, { type Express } from 'express';
import { errorHandler, notFoundHandler, requestId } from './http/errorHandler';
import { createAnalysesController } from './http/controllers/analyses';
import { createArticlesController } from './http/controllers/articles';
import type { AnalysisService } from './services/analysisService';
import type { ArticleService } from './services/articleService';

/**
 * Services only. Controllers talk to services and services talk to repositories, so
 * the app never holds a repository and cannot reach past a service to one.
 */
export interface AppDependencies {
  articleService: ArticleService;
  analysisService: AnalysisService;
  corsOrigin: string;
}

/**
 * Builds the app from its dependencies and never listens, so tests drive it in
 * process with fake services and no port.
 */
export function createApp({ articleService, analysisService, corsOrigin }: AppDependencies): Express {
  const app = express();

  app.use(requestId);
  // Needed only in development, where Vite serves the client from another origin.
  // In production this process serves the built app, so requests are same-origin.
  app.use(cors({ origin: corsOrigin }));
  // An analysis request carries an article, not a file.
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/v1/articles', createArticlesController(articleService));
  app.use('/api/v1/analyses', createAnalysesController(analysisService));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
