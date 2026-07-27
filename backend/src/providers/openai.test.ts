import type { Article } from '@news-feed/api-contract';
import { describe, expect, it, vi } from 'vitest';
import {
  createOpenAiAnalyzer,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
} from './openai';
import { PROMPT_VERSION } from './prompt';

const article: Article = {
  url: 'https://example.com/a',
  title: 'Central bank holds rates steady',
  description: 'The decision was widely expected.',
  content: 'Policymakers voted to hold rates... [2100 chars]',
  imageUrl: null,
  sourceName: 'Example News',
  publishedAt: '2026-07-26T10:00:00Z',
};

const VALID_OUTPUT = {
  summary: 'The central bank held rates steady, as expected.',
  sentiment: 'neutral',
  sentimentScore: 0,
  rationale: 'The article reports the decision without evaluative language.',
};

function completionReturning(content: unknown, usage?: ChatCompletionResponse['usage']) {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  // The request parameter is declared so assertions on mock.calls stay typed.
  return vi.fn(async (_request: ChatCompletionRequest) => ({
    choices: [{ message: { content: text } }],
    usage,
  }));
}

function analyzerFor(createChatCompletion: ReturnType<typeof completionReturning>) {
  return createOpenAiAnalyzer({ createChatCompletion, model: 'gpt-4.1-nano' });
}

describe('createOpenAiAnalyzer', () => {
  it('returns the parsed analysis with its provenance', async () => {
    const result = await analyzerFor(completionReturning(VALID_OUTPUT)).analyze(article);

    expect(result.output).toEqual(VALID_OUTPUT);
    expect(result.model).toBe('gpt-4.1-nano');
    expect(result.promptVersion).toBe(PROMPT_VERSION);
  });

  it('records token usage for cost tracking', async () => {
    const result = await analyzerFor(
      completionReturning(VALID_OUTPUT, { prompt_tokens: 812, completion_tokens: 96 }),
    ).analyze(article);

    expect(result.tokensIn).toBe(812);
    expect(result.tokensOut).toBe(96);
  });

  it('stores null usage rather than zero when the provider omits it', async () => {
    // Zero would be indistinguishable from a genuinely free call in later analysis.
    const result = await analyzerFor(completionReturning(VALID_OUTPUT)).analyze(article);

    expect(result.tokensIn).toBeNull();
    expect(result.tokensOut).toBeNull();
  });

  it('measures latency', async () => {
    const result = await analyzerFor(completionReturning(VALID_OUTPUT)).analyze(article);

    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.latencyMs)).toBe(true);
  });

  it('requests strict structured output against the shared schema', async () => {
    const createChatCompletion = completionReturning(VALID_OUTPUT);
    await analyzerFor(createChatCompletion).analyze(article);

    const request = createChatCompletion.mock.calls[0]![0];
    expect(request.response_format.type).toBe('json_schema');
    expect(request.response_format.json_schema.strict).toBe(true);
    expect(request.response_format.json_schema.schema.properties.sentiment.enum).toEqual([
      'positive',
      'neutral',
      'negative',
    ]);
  });

  it('caps max_tokens so a runaway generation cannot be billed in full', async () => {
    const createChatCompletion = completionReturning(VALID_OUTPUT);
    await analyzerFor(createChatCompletion).analyze(article);

    expect(createChatCompletion.mock.calls[0]![0].max_tokens).toBeGreaterThan(0);
  });

  it('rejects a sentiment outside the closed set', async () => {
    // Strict mode should prevent this; the check exists because the schema is a
    // promise made by a remote service.
    const analyzer = analyzerFor(completionReturning({ ...VALID_OUTPUT, sentiment: 'mixed' }));

    await expect(analyzer.analyze(article)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('rejects a score outside -1..1, which strict mode cannot express', async () => {
    const analyzer = analyzerFor(completionReturning({ ...VALID_OUTPUT, sentimentScore: 4 }));

    await expect(analyzer.analyze(article)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('rejects an empty summary rather than storing a silent failure', async () => {
    const analyzer = analyzerFor(completionReturning({ ...VALID_OUTPUT, summary: '' }));

    await expect(analyzer.analyze(article)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('rejects truncated JSON, which is what hitting max_tokens produces', async () => {
    const analyzer = analyzerFor(completionReturning('{"summary":"half a sen'));

    await expect(analyzer.analyze(article)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('surfaces a refusal as an upstream error rather than an empty analysis', async () => {
    const refusing = vi.fn(async () => ({
      choices: [{ message: { content: null, refusal: 'I cannot help with that.' } }],
    }));
    const analyzer = createOpenAiAnalyzer({ createChatCompletion: refusing, model: 'gpt-4.1-nano' });

    await expect(analyzer.analyze(article)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('surfaces a transport failure as an upstream error', async () => {
    const failing = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    const analyzer = createOpenAiAnalyzer({ createChatCompletion: failing, model: 'gpt-4.1-nano' });

    await expect(analyzer.analyze(article)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', status: 502 });
  });
});
