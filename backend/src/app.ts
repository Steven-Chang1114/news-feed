import { join } from 'node:path';
import cors from 'cors';
import express, { type Express } from 'express';
import { errorHandler, notFoundHandler, requestId } from './http/errorHandler';
import { createAnalysisController } from './http/controllers/analysisController';
import { createArticleController } from './http/controllers/articleController';
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
  /**
   * Directory holding the built client. Set in production, where this process
   * serves both; absent in development, where Vite serves the client and proxies
   * here.
   */
  staticDir?: string;
}

/**
 * Builds the app from its dependencies and never listens, so tests drive it in
 * process with fake services and no port.
 */
export function createApp({
  articleService,
  analysisService,
  corsOrigin,
  staticDir,
}: AppDependencies): Express {
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

  app.use('/api/v1/articles', createArticleController(articleService));
  app.use('/api/v1/analyses', createAnalysisController(analysisService));

  if (staticDir) {
    app.use(express.static(staticDir, { index: false }));

    /**
     * Client routes such as `/feed` exist only in the browser's router, so a reload
     * or a shared link must still be answered with the app shell.
     *
     * The regex excludes `/api/` so an unknown endpoint keeps returning the JSON
     * error envelope rather than a page of HTML — a client parsing that as JSON
     * would report a confusing syntax error instead of a 404.
     */
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(join(staticDir, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
