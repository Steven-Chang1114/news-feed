# news-feed — project plan

Working spec for the Aries engineering case study. This file is the source of truth
for scope; if something is not here, it is not being built.

## The brief

Build a web app that lets a user search recent news articles, pick one, generate a
summary and sentiment score with an LLM, store the result, and display all stored
results back to the user.

Graded on: **product design and UX**, **REST API design**, **AI features**.

Estimated at 1–3 hours. The follow-up round is a **live coding session in this
codebase with no AI assistance**, which is the constraint driving most decisions
below: small, boring, and navigable beats clever.

## Scope

### In scope

| # | Feature | Status |
| --- | --- | --- |
| 1 | Search recent news by keyword | contract + repo done |
| 2 | See at a glance which results are already analyzed | contract + repo done |
| 3 | Analyze an article — LLM summary, sentiment label, score, one-line rationale | PR 4–5 |
| 4 | Re-analyze an article; the new result replaces the old one | repo done |
| 5 | Feed of every stored analysis, newest first | repo done |
| 6 | Filter the feed by sentiment | repo done |
| 7 | Page through the feed | repo done |
| 8 | Permalink to a single analysis | repo done |

### Explicitly out of scope

Cut deliberately, not forgotten. Each was considered and rejected as unasked-for:

- Authentication and multi-user accounts — the brief describes one user
- Batch analysis of several articles at once
- Keeping a history of analyses per article (superseded by feature 4)
- Sentiment breakdown / "mood bar" aggregate counts
- Persisting search results that were never analyzed
- Semantic search, embeddings, `pgvector`
- Docker for the app itself, CI pipelines

## User flow

```
Search page
  type a query
    → results list, each card showing title, source, date, snippet
      → card already analyzed?  → "View analysis" link
      → not analyzed?           → "Analyze" button
        → click: card shows a pending state
        → done: card links to the new analysis

Feed page
  every stored analysis, newest first
    → filter chips: all / positive / neutral / negative
    → "Load more" (cursor-based)
    → each card: title, source, sentiment chip, summary, rationale,
      link to the original article, "Re-analyze"

Analysis page
  one analysis, reachable by permalink from a search result
```

## Pages

| Route | Purpose | Notes |
| --- | --- | --- |
| `/` | Search | Debounced input, loading / empty / error states |
| `/feed` | Stored analyses | Sentiment filter, cursor paging |
| `/analyses/:id` | Single analysis | Permalink target from search results |

UI is plain CSS with custom-property tokens and a system font stack. No component
or styling library — this is a stated requirement.

## API

Base path `/api/v1`. Every payload is defined in `api-contract/`.

| Method | Path | Purpose | Success | Errors |
| --- | --- | --- | --- | --- |
| `GET` | `/articles?q=&lang=&limit=` | Search the news provider, annotated with `analysisId` where already analyzed | 200 | 400, 429, 502 |
| `POST` | `/analyses` | Analyze an article; replaces any previous result for that URL | 201 | 400, 429, 502 |
| `GET` | `/analyses?limit=&cursor=&sentiment=` | The feed, newest first | 200 | 400 |
| `GET` | `/analyses/:id` | One analysis | 200 | 404 |
| `GET` | `/health` | Liveness | 200 | — |

`q` is required on `/articles`: there is no "all news" collection to return.

Every failure uses one envelope — `{ error: { code, message, details?, requestId } }`
— so a client writes one handler rather than branching on status codes.

## Data model

Two tables. See `backend/src/db/migrations/001_init.sql`.

**`articles`** — snapshot of an article at analysis time. Article data cannot be
re-fetched later: the free news tier allows 100 requests/day and articles drop out
of its window.

```
id  url(unique)  title  description  content  image_url  source_name
published_at  raw(jsonb)  created_at  updated_at
```

**`analyses`** — one per article, `UNIQUE (article_id)`. Re-analyzing replaces.

```
id  article_id(fk,unique)  summary  sentiment(check)  sentiment_score(check)
rationale  model  prompt_version  tokens_in  tokens_out  latency_ms  created_at
```

`created_at` is never updated on replace: it is the feed's sort key, and mutating it
would reorder rows underneath someone paginating.

## Conventions

**Type naming.** One concept, three shapes:

```
AnalysisOutput   what the model returns     no id, no provenance
Analysis         what the API returns       id, nested article
AnalysisRow      what a database row holds  FK, tokens, latency, raw
```

- Everything exported from `api-contract/` is a wire type. Resources take no suffix;
  wrappers state what they are (`ListAnalysesResponse`, `CreateAnalysisRequest`).
- `Row` types live in `backend/src/db/` and never escape the repository layer.
- Repository method `foo` takes `FooParams`; it returns a contract type where one
  fits, and `FooResult` only where none does.
- Identifiers use American spellings (`analyze`).

**Directories** are named for the role they play: `frontend`, `backend`,
`api-contract`.

**SQL** lives only in `backend/src/db/repositories/`. Never in a route or a service.

**Comments** carry the reasoning for anything non-obvious — this codebase has to be
defended out loud, without AI, in the next round.

**Scope discipline.** If the brief does not ask for it and no existing code needs it,
it does not ship.

## Delivery

Seven PRs, each independently reviewable.

| # | Branch | Contents | Status |
| --- | --- | --- | --- |
| 1 | `chore/scaffold-workspace` | Workspaces, tsconfig, Docker Postgres, secrets handling | merged |
| 2 | `feat/api-contract` | Zod schemas for every payload | merged |
| 3 | `feat/db-layer` | Schema, migrations, repositories | in review |
| 4 | `feat/providers` | GNews + OpenAI behind swappable interfaces | next |
| 5 | `feat/rest-api` | Express 5, routes, middleware, error envelope | |
| 6 | `feat/web-client` | Vue 3 SPA | |
| 7 | `chore/deploy` | Serve SPA from Express, Neon + Render, README | |

## Stack

Vue 3 + TypeScript (Vite) · Node 22 + Express 5 · PostgreSQL via `postgres.js` with
hand-written SQL · Zod contract shared by both sides · OpenAI `gpt-4.1-nano` with
strict Structured Outputs.

Hosting: one Render service serving both the API and the built SPA, with Postgres on
Neon (Render's free Postgres deletes itself 30 days after creation).
