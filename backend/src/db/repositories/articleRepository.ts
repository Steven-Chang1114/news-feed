import type { Article } from '@news-feed/api-contract';
import type { Db } from '../client';

export interface ArticleRepository {
  /** Inserts the article, or refreshes it if we already hold that URL. Returns its id. */
  upsert(article: Article, raw: unknown): Promise<string>;
}

export function createArticleRepository(sql: Db): ArticleRepository {
  return {
    async upsert(article, raw) {
      /**
       * `ON CONFLICT (url) DO UPDATE` rather than `DO NOTHING`, because `DO NOTHING`
       * returns no row on conflict and we would need a second query to get the id.
       * Updating is also correct on its own terms: a provider may have corrected a
       * headline or filled in an image since we last saw the article.
       *
       * `RETURNING` is the reason this is one round trip instead of two — the main
       * concrete thing Postgres gives us here that MySQL would not.
       */
      const rows = await sql<{ id: string }[]>`
        INSERT INTO articles (url, title, description, content, image_url, source_name, published_at, raw)
        VALUES (
          ${article.url},
          ${article.title},
          ${article.description},
          ${article.content},
          ${article.imageUrl},
          ${article.sourceName},
          ${article.publishedAt},
          ${sql.json(raw as never)}
        )
        ON CONFLICT (url) DO UPDATE SET
          title        = EXCLUDED.title,
          description  = EXCLUDED.description,
          content      = EXCLUDED.content,
          image_url    = EXCLUDED.image_url,
          source_name  = EXCLUDED.source_name,
          published_at = EXCLUDED.published_at,
          raw          = EXCLUDED.raw,
          updated_at   = now()
        RETURNING id
      `;

      // ON CONFLICT DO UPDATE always returns a row, so this is unreachable in
      // practice — but `noUncheckedIndexedAccess` is right to make us say so.
      if (!rows[0]) throw new Error('article upsert returned no row');
      return rows[0].id;
    },
  };
}
