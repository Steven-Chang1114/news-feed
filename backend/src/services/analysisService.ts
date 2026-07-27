import type {
  AnalysisResponse,
  Article,
  ListAnalysesResponse,
  ParsedListAnalysesQuery,
} from '@news-feed/api-contract';
import type { Sql } from '../db/client';
import { createAnalysisRepository, type AnalysisRepository } from '../db/repositories/analysisRepository';
import { createArticleRepository } from '../db/repositories/articleRepository';
import type { Analyzer } from '../providers/types';

export interface AnalysisService {
  analyze(article: Article): Promise<AnalysisResponse>;
  list(query: ParsedListAnalysesQuery): Promise<ListAnalysesResponse>;
  /** False when the analysis was already gone, so a controller can answer 404. */
  delete(id: string): Promise<boolean>;
}

/**
 * Takes the pool rather than a `Db`, because opening the transaction is the point of
 * this layer: analyzing writes an article and an analysis, and an article with no
 * analysis is a silently missing feed entry.
 */
export function createAnalysisService(
  sql: Sql,
  analyzer: Analyzer,
  analysisRepo: AnalysisRepository,
): AnalysisService {
  return {
    async analyze(article) {
      // Outside the transaction on purpose. This takes seconds, and holding a
      // transaction open across it would pin a connection and hold locks for the
      // whole round trip.
      const result = await analyzer.analyze(article);

      return sql.begin(async (tx) => {
        const articleId = await createArticleRepository(tx).upsert(article);

        return createAnalysisRepository(tx).upsert({
          articleId,
          ...result.output,
          model: result.model,
          promptVersion: result.promptVersion,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          latencyMs: result.latencyMs,
        });
      });
    },

    list: (query) => analysisRepo.list(query),

    delete: (id) => analysisRepo.delete(id),
  };
}
