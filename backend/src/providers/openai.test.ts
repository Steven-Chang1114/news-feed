import type { Article } from '@news-feed/api-contract';
import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { createOpenAiAnalyzer } from './openai';
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
};

/** A stand-in for the SDK client, so no test constructs one or reaches the network. */
function fakeClient(message: unknown, usage?: unknown) {
  // The request parameter is declared so assertions on mock.calls stay typed.
  const create = vi.fn(async (_request: OpenAI.Chat.Completions.ChatCompletionCreateParams) => ({
    choices: [{ message }],
    usage,
  }));
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create };
}

function respondingWith(content: unknown, usage?: unknown) {
  return fakeClient({ content: typeof content === 'string' ? content : JSON.stringify(content) }, usage);
}

function analyzerFor(client: OpenAI) {
  return createOpenAiAnalyzer(client, 'gpt-4.1-nano');
}

describe('createOpenAiAnalyzer', () => {
  it('returns the parsed analysis with its provenance', async () => {
    const result = await analyzerFor(respondingWith(VALID_OUTPUT).client).analyze(article);

    expect(result.output).toEqual(VALID_OUTPUT);
    expect(result.model).toBe('gpt-4.1-nano');
    expect(result.promptVersion).toBe(PROMPT_VERSION);
  });

  it('records token usage for cost tracking', async () => {
    const { client } = respondingWith(VALID_OUTPUT, { prompt_tokens: 812, completion_tokens: 96 });

    const result = await analyzerFor(client).analyze(article);

    expect(result.tokensIn).toBe(812);
    expect(result.tokensOut).toBe(96);
  });

  it('stores null usage rather than zero when the provider omits it', async () => {
    // Zero would be indistinguishable from a genuinely free call in later analysis.
    const result = await analyzerFor(respondingWith(VALID_OUTPUT).client).analyze(article);

    expect(result.tokensIn).toBeNull();
    expect(result.tokensOut).toBeNull();
  });

  it('measures latency', async () => {
    const result = await analyzerFor(respondingWith(VALID_OUTPUT).client).analyze(article);

    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.latencyMs)).toBe(true);
  });

  it('requests strict structured output against the shared schema', async () => {
    const { client, create } = respondingWith(VALID_OUTPUT);
    await analyzerFor(client).analyze(article);

    const request = create.mock.calls[0]![0];
    expect(request.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: {
        strict: true,
        schema: { properties: { sentiment: { enum: ['positive', 'neutral', 'negative'] } } },
      },
    });
    // A cap so a runaway generation cannot be billed in full.
    expect(request.max_tokens).toBeGreaterThan(0);
  });

  it('rejects a sentiment outside the closed set', async () => {
    // Strict mode should prevent this; the check exists because the schema is a
    // promise made by a remote service.
    const { client } = respondingWith({ ...VALID_OUTPUT, sentiment: 'mixed' });

    await expect(analyzerFor(client).analyze(article)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('rejects a score outside -1..1, which strict mode cannot express', async () => {
    const { client } = respondingWith({ ...VALID_OUTPUT, sentimentScore: 4 });

    await expect(analyzerFor(client).analyze(article)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('rejects an empty summary rather than storing a silent failure', async () => {
    const { client } = respondingWith({ ...VALID_OUTPUT, summary: '' });

    await expect(analyzerFor(client).analyze(article)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('rejects truncated JSON, which is what hitting max_tokens produces', async () => {
    const { client } = respondingWith('{"summary":"half a sen');

    await expect(analyzerFor(client).analyze(article)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('surfaces a refusal as an upstream error rather than an empty analysis', async () => {
    const { client } = fakeClient({ content: null, refusal: 'I cannot help with that.' });

    await expect(analyzerFor(client).analyze(article)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('surfaces a transport failure as an upstream error', async () => {
    const create = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    const client = { chat: { completions: { create } } } as unknown as OpenAI;

    await expect(analyzerFor(client).analyze(article)).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      status: 502,
    });
  });
});
