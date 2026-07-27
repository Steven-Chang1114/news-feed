import type { AnalysisOutput, Article, ParsedListArticlesQuery } from '@news-feed/api-contract';

/**
 * The two things this app needs from the outside world, expressed as interfaces so
 * the services above them depend on a capability rather than on GNews and OpenAI.
 *
 * The practical payoff is testing: every test in this codebase runs against a fake
 * implementation, so no suite spends quota or reaches the network.
 */

/** A source of news articles. */
export interface NewsProvider {
  search(params: ParsedListArticlesQuery): Promise<Article[]>;
}

/** Produces a summary and sentiment for an article. */
export interface Analyzer {
  analyze(article: Article): Promise<AnalyzeResult>;
}

export interface AnalyzeResult {
  output: AnalysisOutput;
  /** Provenance and cost, recorded with the result so runs can be compared. */
  model: string;
  promptVersion: string;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
}
