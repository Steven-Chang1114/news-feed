import type { Analysis, ListAnalysesResponse, Sentiment } from '@news-feed/api-contract';
import type { Sql } from '../client';
import { decodeCursor, encodeCursor } from '../cursor';
import type { AnalysisWithArticleRow } from '../types';

/**
 * Repository parameter and return types follow one rule: method `foo` takes
 * `FooParams` and returns either a contract type or `FooResult`.
 *
 * Deliberately not `AnalysisInput` — `Input`/`Output` is reserved for the model
 * layer (`AnalysisOutput` is what the LLM returns), and these are arguments to a
 * database call.
 */
export interface UpsertAnalysisParams {
  articleId: string;
  summary: string;
  sentiment: Sentiment;
  sentimentScore: number;
  rationale: string;
  model: string;
  promptVersion: string;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number | null;
}

export interface ListAnalysesParams {
  limit: number;
  cursor?: string | undefined;
  sentiment?: Sentiment | undefined;
}

/**
 * Four methods, one per thing the product does: analyze an article, open one,
 * mark up search results, and read the feed.
 */
export interface AnalysisRepository {
  /** Stores the analysis, replacing any previous one for the same article. */
  upsert(params: UpsertAnalysisParams): Promise<Analysis>;
  /** Backs `GET /analyses/:id`, and reads back what `upsert` just wrote. */
  findById(id: string): Promise<Analysis | null>;
  /** Article URL -> analysis id, for every URL already analyzed. One query for a whole page of search results. */
  findIdsByUrls(urls: string[]): Promise<Map<string, string>>;
  /**
   * Backs `GET /analyses`. Returns the contract's response type directly rather
   * than a repository-specific twin: the shapes are identical, and this layer
   * already returns contract types elsewhere. If the response ever gains a field
   * storage does not produce, that is the moment to split them.
   */
  list(params: ListAnalysesParams): Promise<ListAnalysesResponse>;
}

/** Storage shape -> wire shape. The one place rows are allowed to become contract types. */
function toAnalysis(row: AnalysisWithArticleRow): Analysis {
  return {
    id: row.id,
    summary: row.summary,
    sentiment: row.sentiment,
    sentimentScore: row.sentimentScore,
    rationale: row.rationale,
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

export function createAnalysisRepository(sql: Sql): AnalysisRepository {
  // Every read returns the same columns, so the projection is written once. Explicit
  // rather than `SELECT *`, so adding an internal column cannot start shipping it.
  const columns = sql`
    a.id, a.summary, a.sentiment, a.sentiment_score, a.rationale,
    a.model, a.prompt_version, a.created_at,
    ar.url, ar.title, ar.description, ar.content,
    ar.image_url, ar.source_name, ar.published_at
  `;

  const repository: AnalysisRepository = {
    async upsert(input) {
      /**
       * `DO UPDATE` rather than `DO NOTHING`: analyzing an article again is an
       * explicit request for a fresh result, so the newest one replaces the old.
       * The unique index on article_id is what makes that atomic — two concurrent
       * requests produce one row, not two, without a check-then-insert race.
       *
       * `created_at` is deliberately not touched, so re-analyzing does not reorder
       * the feed underneath someone who is scrolling it.
       */
      const rows = await sql<{ id: string }[]>`
        INSERT INTO analyses (
          article_id, summary, sentiment, sentiment_score, rationale,
          model, prompt_version, tokens_in, tokens_out, latency_ms
        )
        VALUES (
          ${input.articleId}, ${input.summary}, ${input.sentiment}, ${input.sentimentScore},
          ${input.rationale}, ${input.model}, ${input.promptVersion},
          ${input.tokensIn}, ${input.tokensOut}, ${input.latencyMs}
        )
        ON CONFLICT (article_id) DO UPDATE SET
          summary         = EXCLUDED.summary,
          sentiment       = EXCLUDED.sentiment,
          sentiment_score = EXCLUDED.sentiment_score,
          rationale       = EXCLUDED.rationale,
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

    async findIdsByUrls(urls) {
      // Valid SQL with an empty array, but a pointless round trip.
      if (urls.length === 0) return new Map();

      // One query for a whole page of search results, rather than one per card.
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
       * One static query with nullable parameters, rather than assembling WHERE
       * fragments conditionally. `NULL OR <predicate>` is true when the filter is
       * absent, so the same SQL serves all four filter combinations — which matters
       * more than a marginally tighter plan in a codebase that has to be modified
       * from memory.
       *
       * `limit + 1` is the has-next-page probe: if the extra row comes back there is
       * another page, and it is discarded rather than returned.
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
