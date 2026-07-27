import cors from 'cors';
import express, { type Express } from 'express';
import type { AnalysisRepository } from './db/repositories/analysisRepository';
import type { NewsProvider } from './providers/types';
import type { AnalysisService } from './services/analysisService';
import { errorHandler, notFoundHandler, requestId } from './http/errorHandler';
import { createAnalysesRouter } from './http/routes/analyses';
import { createArticlesRouter } from './http/routes/articles';

export interface AppDependencies {
  news: NewsProvider;
  analyses: AnalysisRepository;
  analysisService: AnalysisService;
  corsOrigin: string;
}

/**
 * Builds the app from its dependencies and never listens, so tests drive it in
 * process with fake providers and no port.
 */
export function createApp({ news, analyses, analysisService, corsOrigin }: AppDependencies): Express {
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

  app.use('/api/v1/articles', createArticlesRouter(news, analyses));
  app.use('/api/v1/analyses', createAnalysesRouter(analyses, analysisService));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
