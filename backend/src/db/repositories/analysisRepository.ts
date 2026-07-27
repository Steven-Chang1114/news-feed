import type {
  AnalysisOutput,
  AnalysisResponse,
  ListAnalysesResponse,
  ParsedListAnalysesQuery,
} from '@news-feed/api-contract';
import type { Db } from '../client';
import { decodeCursor, encodeCursor } from '../cursor';
import type { AnalysisWithArticleRow } from '../types';

/** The model's output, plus what storage adds around it. */
export interface UpsertAnalysisParams extends AnalysisOutput {
  articleId: string;
  /** Which model and prompt produced this result. */
  model: string;
  promptVersion: string;
  /** Cost and latency observability. Null when a provider omits usage data. */
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number | null;
}

export interface AnalysisRepository {
  /** Stores the analysis, replacing any previous one for the same article. */
  upsert(params: UpsertAnalysisParams): Promise<AnalysisResponse>;
  /** Reads back the joined shape after `upsert`. No route exposes this. */
  findById(id: string): Promise<AnalysisResponse | null>;
  /** Removes an analysis from the feed. False when it was already gone, so a route can 404. */
  delete(id: string): Promise<boolean>;
  /** Article URL -> analysis id, for every URL already analyzed. One query per page of search results. */
  findIdsByUrls(urls: string[]): Promise<Map<string, string>>;
  /** Backs `GET /analyses`. */
  list(params: ParsedListAnalysesQuery): Promise<ListAnalysesResponse>;
}

/** Storage shape -> wire shape. The one place rows become contract types. */
function toAnalysis(row: AnalysisWithArticleRow): AnalysisResponse {
  return {
    id: row.id,
    summary: row.summary,
    sentiment: row.sentiment,
    sentimentScore: row.sentimentScore,
    model: row.model,
    promptVersion: row.promptVersion,
    createdAt: row.createdAt.toISOString(),
    article: {
      url: row.url,
      title: row.title,
      description: row.description,
      content: row.content,
      imageUrl: row.imageUrl,
      sourceName: row.sourceName,
      publishedAt: row.publishedAt?.toISOString() ?? null,
    },
  };
}

export function createAnalysisRepository(sql: Db): AnalysisRepository {
  // Every read returns the same columns. Listing them explicitly keeps a new
  // internal column from reaching a client by default.
  const columns = sql`
    a.id, a.summary, a.sentiment, a.sentiment_score,
    a.model, a.prompt_version, a.created_at,
    ar.url, ar.title, ar.description, ar.content,
    ar.image_url, ar.source_name, ar.published_at
  `;

  const repository: AnalysisRepository = {
    async upsert(input) {
      /**
       * Analyzing an article again is a request for a fresh result, so the newest
       * one replaces the old. The unique index on article_id makes that atomic:
       * two concurrent requests produce one row.
       *
       * `created_at` is left untouched. It is the feed's sort key, and moving it
       * would reorder rows underneath someone paginating.
       */
      const rows = await sql<{ id: string }[]>`
        INSERT INTO analyses (
          article_id, summary, sentiment, sentiment_score,
          model, prompt_version, tokens_in, tokens_out, latency_ms
        )
        VALUES (
          ${input.articleId}, ${input.summary}, ${input.sentiment}, ${input.sentimentScore},
          ${input.model}, ${input.promptVersion},
          ${input.tokensIn}, ${input.tokensOut}, ${input.latencyMs}
        )
        ON CONFLICT (article_id) DO UPDATE SET
          summary         = EXCLUDED.summary,
          sentiment       = EXCLUDED.sentiment,
          sentiment_score = EXCLUDED.sentiment_score,
          model           = EXCLUDED.model,
          prompt_version  = EXCLUDED.prompt_version,
          tokens_in       = EXCLUDED.tokens_in,
          tokens_out      = EXCLUDED.tokens_out,
          latency_ms      = EXCLUDED.latency_ms
        RETURNING id
      `;

      if (!rows[0]) throw new Error('analysis upsert returned no row');

      const analysis = await repository.findById(rows[0].id);
      if (!analysis) throw new Error('analysis could not be read back after upsert');
      return analysis;
    },

    async findById(id) {
      const rows = await sql<AnalysisWithArticleRow[]>`
        SELECT ${columns}
        FROM analyses a
        JOIN articles ar ON ar.id = a.article_id
        WHERE a.id = ${id}
      `;
      return rows[0] ? toAnalysis(rows[0]) : null;
    },

    async delete(id) {
      /**
       * Only the analysis row. The article stays as a cache, so re-analyzing that
       * URL reuses it, and because `findIdsByUrls` joins through `analyses`, search
       * offers "Analyze" again.
       *
       * `RETURNING id` reports whether anything matched, which is what lets the
       * route answer 404 rather than 204.
       */
      const rows = await sql<{ id: string }[]>`
        DELETE FROM analyses WHERE id = ${id} RETURNING id
      `;
      return rows.length > 0;
    },

    async findIdsByUrls(urls) {
      // Valid SQL with an empty array, but a pointless round trip.
      if (urls.length === 0) return new Map();

      const rows = await sql<{ url: string; id: string }[]>`
        SELECT ar.url, a.id
        FROM articles ar
        JOIN analyses a ON a.article_id = ar.id
        WHERE ar.url = ANY(${urls})
      `;

      return new Map(rows.map((row) => [row.url, row.id]));
    },

    async list({ limit, cursor, sentiment }) {
      const decoded = cursor ? decodeCursor(cursor) : null;

      /**
       * `NULL OR <predicate>` is true when a filter is absent, so this one query
       * serves every combination of sentiment filter and cursor.
       *
       * `limit + 1` probes for a next page: if the extra row comes back there is
       * one, and the row itself is discarded.
       */
      const rows = await sql<AnalysisWithArticleRow[]>`
        SELECT ${columns}
        FROM analyses a
        JOIN articles ar ON ar.id = a.article_id
        WHERE (${sentiment ?? null}::text IS NULL OR a.sentiment = ${sentiment ?? null})
          AND (
            ${decoded?.createdAt ?? null}::timestamptz IS NULL
            OR (a.created_at, a.id) < (${decoded?.createdAt ?? null}::timestamptz, ${decoded?.id ?? null}::uuid)
          )
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${limit + 1}
      `;

      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const hasMore = rows.length > limit;

      return {
        analyses: page.map(toAnalysis),
        nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
      };
    },
  };

  return repository;
}
