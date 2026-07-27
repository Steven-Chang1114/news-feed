import type { AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors';
import { createGNewsProvider } from './gnews';

/**
 * Shaped from a real GNews v4 response, including the free tier's truncated
 * `content` and its trailing "[N chars]" marker.
 */
const GNEWS_ARTICLE = {
  id: '86e60bb3ecb60821ae7c543afdc414a3',
  title: 'Skilled labour and land access remain investment hurdles',
  description: 'Investors continue to face challenges related to skilled labour.',
  content: 'New Delhi [India], July 26 (ANI): Investors continue... [3131 chars]',
  url: 'https://www.tribuneindia.com/news/business/skilled-labour',
  image: 'https://www.tribuneindia.com/image.jpg',
  publishedAt: '2026-07-26T13:03:12Z',
  lang: 'en',
  source: { id: 'c57', name: 'The Tribune', url: 'https://www.tribuneindia.com', country: 'in' },
};

function clientReturning(data: unknown) {
  const get = vi.fn(async () => ({ data }));
  return { get } as unknown as AxiosInstance & { get: typeof get };
}

/** An axios rejection, which is what a non-2xx status produces. */
function clientFailingWith(status?: number) {
  const get = vi.fn(async () => {
    throw Object.assign(new Error('Request failed'), {
      isAxiosError: true,
      response: status === undefined ? undefined : { status },
    });
  });
  return { get } as unknown as AxiosInstance & { get: typeof get };
}

const query = { q: 'climate', lang: 'en', limit: 10 };

describe('createGNewsProvider', () => {
  it('maps a provider article onto the contract shape', async () => {
    const provider = createGNewsProvider({ apiKey: 'k', client: clientReturning({ articles: [GNEWS_ARTICLE] }) });

    const [article] = await provider.search(query);

    expect(article).toEqual({
      url: GNEWS_ARTICLE.url,
      title: GNEWS_ARTICLE.title,
      description: GNEWS_ARTICLE.description,
      content: GNEWS_ARTICLE.content,
      imageUrl: GNEWS_ARTICLE.image,
      sourceName: 'The Tribune',
      publishedAt: '2026-07-26T13:03:12Z',
    });
  });

  it('sends the query, language, limit and key as parameters', async () => {
    const client = clientReturning({ articles: [] });
    await createGNewsProvider({ apiKey: 'secret-key', client }).search({
      q: 'climate change',
      lang: 'fr',
      limit: 5,
    });

    expect(client.get).toHaveBeenCalledWith('/search', {
      params: { q: 'climate change', lang: 'fr', max: 5, apikey: 'secret-key' },
    });
  });

  it('turns absent optional fields into null rather than undefined', async () => {
    // The contract distinguishes the two, and the database column is nullable.
    const sparse = { url: 'https://example.com/a', title: 'A headline' };
    const provider = createGNewsProvider({ apiKey: 'k', client: clientReturning({ articles: [sparse] }) });

    const [article] = await provider.search(query);

    expect(article).toMatchObject({
      description: null,
      content: null,
      imageUrl: null,
      sourceName: null,
      publishedAt: null,
    });
  });

  it('treats an empty string as absent', async () => {
    const blank = { ...GNEWS_ARTICLE, description: '', image: '' };
    const provider = createGNewsProvider({ apiKey: 'k', client: clientReturning({ articles: [blank] }) });

    const [article] = await provider.search(query);

    expect(article?.description).toBeNull();
    expect(article?.imageUrl).toBeNull();
  });

  it('drops a malformed article instead of failing the whole page', async () => {
    const provider = createGNewsProvider({
      apiKey: 'k',
      client: clientReturning({ articles: [{ url: 'not-a-url', title: 'Broken' }, GNEWS_ARTICLE] }),
    });

    const articles = await provider.search(query);

    expect(articles).toHaveLength(1);
    expect(articles[0]?.url).toBe(GNEWS_ARTICLE.url);
  });

  it('reports a quota exhaustion as RATE_LIMITED, not a generic failure', async () => {
    // Reachable in normal use: the free tier allows 100 requests a day.
    const provider = createGNewsProvider({ apiKey: 'k', client: clientFailingWith(429) });

    await expect(provider.search(query)).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
  });

  it('reports any other error status as UPSTREAM_ERROR', async () => {
    const provider = createGNewsProvider({ apiKey: 'k', client: clientFailingWith(503) });

    await expect(provider.search(query)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', status: 502 });
  });

  it('reports a timeout or connection failure as UPSTREAM_ERROR', async () => {
    // No response means the request never completed.
    const error = await createGNewsProvider({ apiKey: 'k', client: clientFailingWith(undefined) })
      .search(query)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('UPSTREAM_ERROR');
  });

  it('reports a body that is not an article list as UPSTREAM_ERROR', async () => {
    // A proxy returning an HTML error page leaves `data` as a string.
    const provider = createGNewsProvider({ apiKey: 'k', client: clientReturning('<html>502</html>') });

    await expect(provider.search(query)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('reports a response with no article list as UPSTREAM_ERROR', async () => {
    const provider = createGNewsProvider({ apiKey: 'k', client: clientReturning({ totalArticles: 0 }) });

    await expect(provider.search(query)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });
});
