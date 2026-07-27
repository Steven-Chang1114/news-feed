import {
  type AnalysisResponse,
  type Article,
  type ListAnalysesQuery,
  type ListArticlesResponse,
  type ListAnalysesResponse,
  errorResponseSchema,
  listAnalysesResponseSchema,
  listArticlesResponseSchema,
} from '@news-feed/api-contract';
import axios, { type AxiosError } from 'axios';

const client = axios.create({ baseURL: '/api/v1', timeout: 30_000 });

/**
 * Turns the API's error envelope into a message worth showing. The server sends the
 * same shape for every failure, so this is the only place the client interprets one.
 */
function toMessage(error: unknown): string {
  const envelope = errorResponseSchema.safeParse((error as AxiosError)?.response?.data);
  if (envelope.success) return envelope.data.error.message;
  if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') return 'The request timed out.';
  return 'Something went wrong. Please try again.';
}

export class ApiError extends Error {
  constructor(cause: unknown) {
    super(toMessage(cause), { cause });
    this.name = 'ApiError';
  }
}

/**
 * Responses are parsed against the contract rather than trusted. A backend shape
 * change then fails here, loudly and in one place, instead of rendering as a blank
 * card somewhere in the page.
 */
async function get<T>(path: string, params: object, parse: (data: unknown) => T): Promise<T> {
  try {
    return parse((await client.get(path, { params })).data);
  } catch (error) {
    throw new ApiError(error);
  }
}

export function searchArticles(q: string, limit = 10): Promise<ListArticlesResponse> {
  return get('/articles', { q, limit }, (data) => listArticlesResponseSchema.parse(data));
}

export function listAnalyses(query: ListAnalysesQuery = {}): Promise<ListAnalysesResponse> {
  return get('/analyses', query, (data) => listAnalysesResponseSchema.parse(data));
}

export async function analyzeArticle(article: Article): Promise<AnalysisResponse> {
  try {
    return (await client.post('/analyses', { article })).data as AnalysisResponse;
  } catch (error) {
    throw new ApiError(error);
  }
}

export async function deleteAnalysis(id: string): Promise<void> {
  try {
    await client.delete(`/analyses/${id}`);
  } catch (error) {
    throw new ApiError(error);
  }
}
