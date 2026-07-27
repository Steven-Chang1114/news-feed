-- Articles we have been asked to analyze, and the analyses themselves.
--
-- Search results are deliberately not stored: only an article the user chose to
-- analyze earns a row, which is what keeps the feed meaningful rather than a log
-- of everything anyone ever typed into a search box.

CREATE TABLE articles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity. Every deduplication in the system keys on this, so the unique index
  -- is what makes "analyze this article" idempotent rather than merely usually-once.
  url           text NOT NULL UNIQUE,

  title         text NOT NULL,
  description   text,
  content       text,
  image_url     text,
  source_name   text,
  published_at  timestamptz,

  -- The provider payload exactly as received. Costs nothing and means a mapping bug
  -- can be corrected by reprocessing rather than by re-fetching from a 100/day quota.
  raw           jsonb NOT NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE analyses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id      uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,

  summary         text NOT NULL,

  -- The database is the last line of defence on model output. The application
  -- validates this too, but application checks only bind the code path that runs
  -- them; a CHECK binds migrations, backfills, fixtures and psql as well.
  sentiment       text NOT NULL CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  sentiment_score real NOT NULL CHECK (sentiment_score BETWEEN -1 AND 1),
  rationale       text NOT NULL,

  -- Provenance. Without these, "did our summaries get better?" is unanswerable,
  -- because the two populations being compared cannot be told apart.
  model           text NOT NULL,
  prompt_version  text NOT NULL,

  -- Cost and latency observability. Nullable because a stored analysis is still
  -- valid if a provider omits usage data.
  tokens_in       integer,
  tokens_out      integer,
  latency_ms      integer,

  created_at      timestamptz NOT NULL DEFAULT now(),

  -- One analysis per article. Analyzing again replaces the previous result rather
  -- than accumulating versions, so the feed can never show the same article twice.
  UNIQUE (article_id)
);

-- Matches the feed's ORDER BY exactly, including the id tiebreaker, so keyset
-- pagination is an index scan rather than a sort.
CREATE INDEX analyses_created_at_id_idx ON analyses (created_at DESC, id DESC);

-- Supports both the sentiment filter and the GROUP BY behind the feed's breakdown.
CREATE INDEX analyses_sentiment_idx ON analyses (sentiment);
