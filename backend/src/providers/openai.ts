import { analysisOutputSchema, type Article } from '@news-feed/api-contract';
import { upstreamError } from '../errors';
import { ANALYSIS_JSON_SCHEMA, PROMPT_VERSION, buildMessages } from './prompt';
import type { AnalyzeResult, Analyzer } from './types';

/**
 * The single API call this adapter makes, as a function type.
 *
 * Isolating it means the analyzer can be tested against a plain function: no SDK
 * construction, no network, no key. `openAiChatCompletion` below is the only place
 * the SDK appears.
 */
export type CreateChatCompletion = (request: ChatCompletionRequest) => Promise<ChatCompletionResponse>;

export interface ChatCompletionRequest {
  model: string;
  messages: { role: 'system' | 'user'; content: string }[];
  temperature: number;
  max_tokens: number;
  response_format: {
    type: 'json_schema';
    json_schema: { name: string; strict: true; schema: typeof ANALYSIS_JSON_SCHEMA };
  };
}

export interface ChatCompletionResponse {
  choices: { message: { content?: string | null; refusal?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

export interface OpenAiAnalyzerOptions {
  createChatCompletion: CreateChatCompletion;
  model: string;
  /**
   * A ceiling on the summary, and a guard: without it a runaway generation is
   * billed in full before anything notices.
   */
  maxTokens?: number;
}

export function createOpenAiAnalyzer({
  createChatCompletion,
  model,
  maxTokens = 500,
}: OpenAiAnalyzerOptions): Analyzer {
  return {
    async analyze(article: Article): Promise<AnalyzeResult> {
      const startedAt = Date.now();

      let response: ChatCompletionResponse;
      try {
        response = await createChatCompletion({
          model,
          messages: buildMessages(article),
          // Low but not zero: summaries stay stable between runs without the
          // degenerate repetition that temperature 0 can produce.
          temperature: 0.2,
          max_tokens: maxTokens,
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'article_analysis', strict: true, schema: ANALYSIS_JSON_SCHEMA },
          },
        });
      } catch (cause) {
        throw upstreamError('The analysis provider did not respond', cause);
      }

      const latencyMs = Date.now() - startedAt;
      const message = response.choices[0]?.message;

      // A refusal is a successful HTTP call carrying no analysis.
      if (message?.refusal) {
        throw upstreamError(`The model declined to analyze this article: ${message.refusal}`);
      }
      if (!message?.content) {
        throw upstreamError('The analysis provider returned an empty response');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(message.content);
      } catch (cause) {
        // Reachable despite strict mode: a response cut short by max_tokens is
        // truncated JSON.
        throw upstreamError('The analysis provider returned malformed JSON', cause);
      }

      // Strict mode makes an invalid shape unlikely, not impossible: the schema is a
      // remote promise, and it does not cover the -1..1 bound on the score.
      const output = analysisOutputSchema.safeParse(parsed);
      if (!output.success) {
        throw upstreamError('The analysis provider returned an unusable analysis');
      }

      return {
        output: output.data,
        model,
        promptVersion: PROMPT_VERSION,
        tokensIn: response.usage?.prompt_tokens ?? null,
        tokensOut: response.usage?.completion_tokens ?? null,
        latencyMs,
      };
    },
  };
}
