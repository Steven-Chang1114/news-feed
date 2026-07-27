import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { createApp } from './app';
import { env } from './config/env';
import { createClient } from './db/client';
import { createAnalysisRepository } from './db/repositories/analysisRepository';
import { createGNewsProvider } from './providers/gnews';
import { createOpenAiAnalyzer } from './providers/openai';
import { createAnalysisService } from './services/analysisService';
import { createArticleService } from './services/articleService';

/**
 * The composition root: the only place that reads configuration and constructs
 * concrete implementations. Everything below it receives what it needs.
 */
const sql = createClient(env.DATABASE_URL);
const analysisRepo = createAnalysisRepository(sql);

const app = createApp({
  articleService: createArticleService(
    createGNewsProvider({ apiKey: env.GNEWS_API_KEY }),
    analysisRepo,
  ),
  analysisService: createAnalysisService(
    sql,
    createOpenAiAnalyzer(
      new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 20_000, maxRetries: 2 }),
      env.OPENAI_MODEL,
    ),
    analysisRepo,
  ),
  corsOrigin: env.CORS_ORIGIN,
  /**
   * In production this process serves the built client too, so there is one origin
   * and no CORS. In development Vite serves it and proxies here, so this is unset
   * and `frontend/dist` need not exist.
   */
  ...(env.NODE_ENV === 'production'
    ? { staticDir: fileURLToPath(new URL('../../frontend/dist/', import.meta.url)) }
    : {}),
});

const server = app.listen(env.PORT, () => {
  console.log(`Listening on http://localhost:${env.PORT}`);
});

/**
 * Render sends SIGTERM on deploy. Closing the server first lets in-flight requests
 * finish before the pool goes away, so a deploy does not answer with a broken
 * connection.
 */
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void sql.end().then(() => process.exit(0));
    });
  });
}
