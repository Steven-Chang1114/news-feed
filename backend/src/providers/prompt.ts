import { SENTIMENTS, type Article } from '@news-feed/api-contract';

/**
 * Bump whenever the prompt or the schema below changes. It is stored with every
 * analysis, so results produced by different wordings stay distinguishable.
 */
export const PROMPT_VERSION = 'v1';

/**
 * Roughly 1000 tokens of article. Longer inputs cost more without improving a
 * three-sentence summary, and on the GNews free tier `content` arrives truncated to
 * a couple of hundred characters anyway.
 */
const MAX_CONTENT_CHARS = 4000;

/**
 * The shape the model must return.
 *
 * With `strict: true` the API constrains decoding to this schema, so the model
 * cannot emit a sentiment outside the enum. Strict mode does not support numeric
 * bounds, so the -1..1 range on `sentimentScore` is enforced by Zod after parsing.
 *
 * The enum is built from SENTIMENTS so the model's options and the rest of the
 * system cannot drift apart.
 */
export const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'Two or three sentences covering what happened and why it matters.',
    },
    sentiment: {
      type: 'string',
      enum: [...SENTIMENTS],
      description: 'The overall tone of the coverage.',
    },
    sentimentScore: {
      type: 'number',
      description: 'Intensity from -1 (most negative) through 0 (neutral) to 1 (most positive).',
    },
    rationale: {
      type: 'string',
      description: 'One sentence explaining the sentiment.',
    },
  },
  required: ['summary', 'sentiment', 'sentimentScore', 'rationale'],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = [
  'You summarize news articles and judge the tone of their coverage.',
  '',
  'Summarize only what the text supports. If the text is a short excerpt, summarize',
  'the excerpt rather than guessing at the rest of the article.',
  '',
  'Sentiment describes the tone of the coverage, not whether the events are good or',
  'bad for any particular group. Neutral is a real answer and is common in factual',
  'reporting; prefer it over a weak positive or negative.',
].join('\n');

export function buildUserPrompt(article: Article): string {
  const content = article.content?.slice(0, MAX_CONTENT_CHARS) ?? null;

  return [
    `Title: ${article.title}`,
    article.sourceName ? `Source: ${article.sourceName}` : null,
    article.description ? `Description: ${article.description}` : null,
    content ? `Content: ${content}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

export function buildMessages(article: Article) {
  return [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: buildUserPrompt(article) },
  ];
}
