import { articleSchema, type Article } from '@news-feed/api-contract';
import axios, { type AxiosInstance } from 'axios';
import { rateLimitedError, upstreamError } from '../errors';
import type { NewsProvider } from './types';

const GNEWS_BASE_URL = 'https://gnews.io/api/v4';

export interface GNewsOptions {
  apiKey: string;
  /** A search sits in front of a user waiting on a page, so it fails fast. */
  timeoutMs?: number;
  /** Injected so tests never reach the network. */
  client?: AxiosInstance;
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
  client = axios.create({ baseURL: GNEWS_BASE_URL, timeout: timeoutMs }),
}: GNewsOptions): NewsProvider {
  return {
    async search({ q, lang, limit }) {
      let data: unknown;
      try {
        // axios rejects on a non-2xx status, so the failure paths are all in catch.
        ({ data } = await client.get('/search', {
          params: { q, lang, max: limit, apikey: apiKey },
        }));
      } catch (cause) {
        const status = axios.isAxiosError(cause) ? cause.response?.status : undefined;

        // The free tier allows 100 requests a day, so this is reachable in normal use.
        if (status === 429) {
          throw rateLimitedError('The news provider daily request limit has been reached');
        }
        if (status !== undefined) {
          throw upstreamError(`The news provider returned ${status}`);
        }
        // No status means the request never completed: timeout, DNS, or connection.
        throw upstreamError('The news provider did not respond', cause);
      }

      const articles = (data as { articles?: unknown } | null)?.articles;
      if (!Array.isArray(articles)) {
        throw upstreamError('The news provider returned no article list');
      }

      const mapped: Article[] = [];
      for (const raw of articles as GNewsArticle[]) {
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
        if (parsed.success) mapped.push(parsed.data);
      }

      return mapped;
    },
  };
}
