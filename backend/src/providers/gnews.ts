import { articleSchema, type Article } from '@news-feed/api-contract';
import { rateLimitedError, upstreamError } from '../errors';
import type { NewsProvider } from './types';

const GNEWS_SEARCH_URL = 'https://gnews.io/api/v4/search';

export interface GNewsOptions {
  apiKey: string;
  /** A search sits in front of a user waiting on a page, so it fails fast. */
  timeoutMs?: number;
  /** Injected so tests never reach the network. */
  fetchImpl?: typeof fetch;
}

/** One article in a GNews v4 response. Every field is treated as untrusted. */
interface GNewsArticle {
  title?: unknown;
  description?: unknown;
  content?: unknown;
  url?: unknown;
  image?: unknown;
  publishedAt?: unknown;
  source?: { name?: unknown } | null;
}

/** Reads a field only when it is a non-empty string, so "" never reaches the database as data. */
function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function createGNewsProvider({
  apiKey,
  timeoutMs = 10_000,
  fetchImpl = fetch,
}: GNewsOptions): NewsProvider {
  return {
    async search({ q, lang, limit }) {
      const url = new URL(GNEWS_SEARCH_URL);
      url.searchParams.set('q', q);
      url.searchParams.set('lang', lang);
      url.searchParams.set('max', String(limit));
      url.searchParams.set('apikey', apiKey);

      let response: Response;
      try {
        response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      } catch (cause) {
        // A timeout arrives here as an AbortError, indistinguishable to a caller
        // from a DNS or connection failure — all of them mean "no results".
        throw upstreamError('The news provider did not respond', cause);
      }

      if (response.status === 429) {
        // The free tier allows 100 requests a day, so this is reachable in normal use.
        throw rateLimitedError('The news provider daily request limit has been reached');
      }
      if (!response.ok) {
        throw upstreamError(`The news provider returned ${response.status}`);
      }

      let body: { articles?: unknown };
      try {
        body = (await response.json()) as { articles?: unknown };
      } catch (cause) {
        throw upstreamError('The news provider returned a malformed response', cause);
      }

      if (!Array.isArray(body.articles)) {
        throw upstreamError('The news provider returned no article list');
      }

      const articles: Article[] = [];
      for (const raw of body.articles as GNewsArticle[]) {
        const candidate = {
          url: raw.url,
          title: raw.title,
          description: optionalString(raw.description),
          content: optionalString(raw.content),
          imageUrl: optionalString(raw.image),
          sourceName: optionalString(raw.source?.name),
          publishedAt: optionalString(raw.publishedAt),
        };

        // A single malformed article should cost the user that result, not the whole
        // page, so it is dropped rather than raised.
        const parsed = articleSchema.safeParse(candidate);
        if (parsed.success) articles.push(parsed.data);
      }

      return articles;
    },
  };
}
