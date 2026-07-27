-- Articles that have been analyzed, and the analyses themselves.
--
-- Search results are not stored. Only an article the user chose to analyze earns a
-- row, which keeps the feed a record of what was read rather than what was typed
-- into a search box.

CREATE TABLE articles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity. Every deduplication in the system keys on this, and the unique index
  -- is what makes analyzing an article idempotent.
  url           text NOT NULL UNIQUE,

  title         text NOT NULL,
  description   text,
  content       text,
  image_url     text,
  source_name   text,
  published_at  timestamptz,


  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE analyses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id      uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,

  summary         text NOT NULL,

  -- These values come from a language model. Application validation binds only the
  -- code path that runs it; a CHECK binds migrations, backfills, fixtures and psql
  -- as well.
  sentiment       text NOT NULL CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  sentiment_score real NOT NULL CHECK (sentiment_score BETWEEN -1 AND 1),

  -- Which model and prompt produced the result, so two versions can be compared.
  model           text NOT NULL,
  prompt_version  text NOT NULL,

  -- Cost and latency observability. Nullable because a stored analysis is still
  -- valid if a provider omits usage data.
  tokens_in       integer,
  tokens_out      integer,
  latency_ms      integer,

  created_at      timestamptz NOT NULL DEFAULT now(),

  -- One analysis per article. Analyzing again replaces the previous result, so the
  -- feed cannot show the same article twice.
  UNIQUE (article_id)
);

-- Matches the feed's ORDER BY including its id tiebreaker, so keyset pagination is
-- an index scan rather than a sort.
CREATE INDEX analyses_created_at_id_idx ON analyses (created_at DESC, id DESC);

-- Serves both the sentiment filter and any grouping by sentiment.
CREATE INDEX analyses_sentiment_idx ON analyses (sentiment);
