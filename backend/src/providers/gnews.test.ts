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

function respondWith(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

const query = { q: 'climate', lang: 'en', limit: 10 };

describe('createGNewsProvider', () => {
  it('maps a provider article onto the contract shape', async () => {
    const provider = createGNewsProvider({ apiKey: 'k', fetchImpl: respondWith({ articles: [GNEWS_ARTICLE] }) });

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
    const fetchImpl = respondWith({ articles: [] });
    await createGNewsProvider({ apiKey: 'secret-key', fetchImpl }).search({
      q: 'climate change',
      lang: 'fr',
      limit: 5,
    });

    const url = new URL(String(vi.mocked(fetchImpl).mock.calls[0]![0]));
    expect(url.searchParams.get('q')).toBe('climate change');
    expect(url.searchParams.get('lang')).toBe('fr');
    expect(url.searchParams.get('max')).toBe('5');
    expect(url.searchParams.get('apikey')).toBe('secret-key');
  });

  it('turns absent optional fields into null rather than undefined', async () => {
    // The contract distinguishes the two, and the database column is nullable.
    const sparse = { url: 'https://example.com/a', title: 'A headline' };
    const provider = createGNewsProvider({ apiKey: 'k', fetchImpl: respondWith({ articles: [sparse] }) });

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
    const provider = createGNewsProvider({ apiKey: 'k', fetchImpl: respondWith({ articles: [blank] }) });

    const [article] = await provider.search(query);

    expect(article?.description).toBeNull();
    expect(article?.imageUrl).toBeNull();
  });

  it('drops a malformed article instead of failing the whole page', async () => {
    const provider = createGNewsProvider({
      apiKey: 'k',
      fetchImpl: respondWith({ articles: [{ url: 'not-a-url', title: 'Broken' }, GNEWS_ARTICLE] }),
    });

    const articles = await provider.search(query);

    expect(articles).toHaveLength(1);
    expect(articles[0]?.url).toBe(GNEWS_ARTICLE.url);
  });

  it('reports a quota exhaustion as RATE_LIMITED, not a generic failure', async () => {
    // Reachable in normal use: the free tier allows 100 requests a day.
    const provider = createGNewsProvider({ apiKey: 'k', fetchImpl: respondWith({}, 429) });

    await expect(provider.search(query)).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
  });

  it('reports any other error status as UPSTREAM_ERROR', async () => {
    const provider = createGNewsProvider({ apiKey: 'k', fetchImpl: respondWith({}, 503) });

    await expect(provider.search(query)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', status: 502 });
  });

  it('reports a network failure or timeout as UPSTREAM_ERROR', async () => {
    const failing = vi.fn(async () => {
      throw new DOMException('The operation was aborted', 'AbortError');
    }) as unknown as typeof fetch;

    const error = await createGNewsProvider({ apiKey: 'k', fetchImpl: failing })
      .search(query)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('UPSTREAM_ERROR');
  });

  it('reports a response that is not JSON as UPSTREAM_ERROR', async () => {
    const html = vi.fn(async () => new Response('<html>502</html>', { status: 200 })) as unknown as typeof fetch;

    await expect(createGNewsProvider({ apiKey: 'k', fetchImpl: html }).search(query)).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
  });

  it('reports a response with no article list as UPSTREAM_ERROR', async () => {
    const provider = createGNewsProvider({ apiKey: 'k', fetchImpl: respondWith({ totalArticles: 0 }) });

    await expect(provider.search(query)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });
});
