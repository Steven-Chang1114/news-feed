import type { Analysis, Sentiment, SentimentBreakdown } from '@news-feed/api-contract';
import type { Sql } from '../client';
import { decodeCursor, encodeCursor } from '../cursor';
import type { AnalysisWithArticleRow } from '../types';

export interface CreateAnalysisInput {
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

export interface ListAnalysesOptions {
  limit: number;
  cursor?: string | undefined;
  sentiment?: Sentiment | undefined;
}

export interface ListAnalysesResult {
  analyses: Analysis[];
  nextCursor: string | null;
}

export interface AnalysisRepository {
  findById(id: string): Promise<Analysis | null>;
  findByArticleUrl(url: string, model: string, promptVersion: string): Promise<Analysis | null>;
  /** `created` is false when an identical analysis already existed, so the route can answer 200 rather than 201. */
  create(input: CreateAnalysisInput): Promise<{ analysis: Analysis; created: boolean }>;
  list(options: ListAnalysesOptions): Promise<ListAnalysesResult>;
  breakdown(): Promise<SentimentBreakdown>;
  /** Maps article URL -> id of its most recent analysis, for annotating search results. */
  findAnalysisIdsByUrls(urls: string[]): Promise<Map<string, string>>;
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
  // Every read returns the same columns, so the projection is written once. Keeping
  // it explicit rather than `SELECT *` means adding an internal column cannot
  // accidentally start shipping it to clients.
  const columns = sql`
    a.id, a.summary, a.sentiment, a.sentiment_score, a.rationale,
    a.model, a.prompt_version, a.created_at,
    ar.url, ar.title, ar.description, ar.content,
    ar.image_url, ar.source_name, ar.published_at
  `;

  const repository: AnalysisRepository = {
    async findById(id) {
      const rows = await sql<AnalysisWithArticleRow[]>`
        SELECT ${columns}
        FROM analyses a
        JOIN articles ar ON ar.id = a.article_id
        WHERE a.id = ${id}
      `;
      return rows[0] ? toAnalysis(rows[0]) : null;
    },

    async findByArticleUrl(url, model, promptVersion) {
      const rows = await sql<AnalysisWithArticleRow[]>`
        SELECT ${columns}
        FROM analyses a
        JOIN articles ar ON ar.id = a.article_id
        WHERE ar.url = ${url}
          AND a.model = ${model}
          AND a.prompt_version = ${promptVersion}
      `;
      return rows[0] ? toAnalysis(rows[0]) : null;
    },

    async create(input) {
      /**
       * `DO NOTHING` rather than `DO UPDATE`: an identical analysis already stored is
       * a duplicate request, not a correction, so the existing row wins and we never
       * pay OpenAI twice for the same work.
       *
       * The service checks `findByArticleUrl` first, so reaching the conflict branch
       * means two requests raced. The unique constraint is what makes that safe —
       * a check-then-insert without it would let both inserts through.
       */
      const inserted = await sql<{ id: string }[]>`
        INSERT INTO analyses (
          article_id, summary, sentiment, sentiment_score, rationale,
          model, prompt_version, tokens_in, tokens_out, latency_ms
        )
        VALUES (
          ${input.articleId}, ${input.summary}, ${input.sentiment}, ${input.sentimentScore},
          ${input.rationale}, ${input.model}, ${input.promptVersion},
          ${input.tokensIn}, ${input.tokensOut}, ${input.latencyMs}
        )
        ON CONFLICT (article_id, model, prompt_version) DO NOTHING
        RETURNING id
      `;

      if (inserted[0]) {
        const analysis = await repository.findById(inserted[0].id);
        if (!analysis) throw new Error('analysis vanished immediately after insert');
        return { analysis, created: true };
      }

      const existing = await sql<{ id: string }[]>`
        SELECT id FROM analyses
        WHERE article_id = ${input.articleId}
          AND model = ${input.model}
          AND prompt_version = ${input.promptVersion}
      `;
      if (!existing[0]) throw new Error('insert conflicted but no conflicting row found');

      const analysis = await repository.findById(existing[0].id);
      if (!analysis) throw new Error('conflicting analysis could not be read back');
      return { analysis, created: false };
    },

    async list({ limit, cursor, sentiment }) {
      const decoded = cursor ? decodeCursor(cursor) : null;

      /**
       * One static query with nullable parameters, rather than assembling WHERE
       * fragments conditionally. `NULL OR <predicate>` short-circuits to true when
       * the filter is absent, so the same SQL serves all four filter combinations —
       * which matters more than a marginally tighter plan in a codebase that has to
       * be modified from memory.
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

    async breakdown() {
      // `::int` matters: postgres.js returns bigint as a string to avoid precision
      // loss, so an uncast `count(*)` would arrive as "3" and quietly break arithmetic.
      const rows = await sql<{ sentiment: Sentiment; count: number }[]>`
        SELECT sentiment, count(*)::int AS count
        FROM analyses
        GROUP BY sentiment
      `;

      const breakdown: SentimentBreakdown = { positive: 0, neutral: 0, negative: 0, total: 0 };
      for (const row of rows) {
        breakdown[row.sentiment] = row.count;
        breakdown.total += row.count;
      }
      return breakdown;
    },

    async findAnalysisIdsByUrls(urls) {
      // `= ANY(empty array)` is valid SQL but a pointless round trip.
      if (urls.length === 0) return new Map();

      /**
       * `DISTINCT ON (ar.url)` with a matching ORDER BY takes the newest analysis per
       * URL in a single pass. An article can hold several analyses once prompt
       * versions differ, and a search card should link to the most recent.
       */
      const rows = await sql<{ url: string; id: string }[]>`
        SELECT DISTINCT ON (ar.url) ar.url, a.id
        FROM articles ar
        JOIN analyses a ON a.article_id = ar.id
        WHERE ar.url = ANY(${urls})
        ORDER BY ar.url, a.created_at DESC
      `;

      return new Map(rows.map((row) => [row.url, row.id]));
    },
  };

  return repository;
}
