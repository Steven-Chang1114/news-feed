# news-feed — project plan

Working spec for the Aries engineering case study, and the source of truth for
scope: if something is not here, it is not being built.

## The brief

Build a web app that lets a user search recent news articles, pick one, generate a
summary and sentiment score with an LLM, store the result, and display all stored
results back to the user.

Graded on: **product design and UX**, **REST API design**, **AI features**.

Estimated at 1–3 hours. The follow-up round is a **live coding session in this
codebase with no AI assistance**, which is the constraint driving most decisions
below: small, boring and navigable beats clever.

## Scope

### In scope

| # | Feature | Status |
| --- | --- | --- |
| 1 | Search recent news by keyword | API done, needs UI |
| 2 | See at a glance which results are already analyzed | API done, needs UI |
| 3 | Analyze an article — LLM summary, sentiment label and score | API done, needs UI |
| 4 | Re-analyze an article; the new result replaces the old one | API done, needs UI |
| 5 | Feed listing every analyzed article with its sentiment label, newest first | API done, needs UI |
| 6 | Click a feed row to reveal its summary | PR 6 |
| 7 | Filter the feed by sentiment | API done, needs UI |
| 8 | Page through the feed | API done, needs UI |
| 9 | Remove an analysis from the feed | API done, needs UI |

### Explicitly out of scope

Cut deliberately, not forgotten:

- Authentication and multi-user accounts — the brief describes one user
- Batch analysis of several articles at once
- Keeping a history of analyses per article (superseded by feature 4)
- A one-line rationale alongside the sentiment — the brief asks for a score
- Sentiment breakdown / "mood bar" aggregate counts
- Persisting search results that were never analyzed
- Semantic search, embeddings, `pgvector`
- Docker for the app itself, CI pipelines
- A dedicated page or permalink for a single analysis — the feed reveals summaries
  in place, so a second page would show nothing the feed does not

## User flow

```
Search page
  type a query
    → results list, each card showing title, source, date, snippet
      → not analyzed?      → "Analyze" button
        → click: pending state, then the row moves to the feed
      → already analyzed?  → "Analyzed" state, linking to the feed

Feed page
  a list of analyzed articles, newest first
  each row, collapsed:  title, source, date, sentiment label
    → click a row → expands in place to reveal
        summary, link to the original article,
        "Re-analyze", "Remove"
    → filter chips: all / positive / neutral / negative
    → "Load more" (cursor-based)
```

The feed is a scannable list first and a reader second: the sentiment label is
visible for every row at a glance, and the summary is one click away without
leaving the page.

## Pages

| Route | Purpose | Notes |
| --- | --- | --- |
| `/` | Search | Debounced input, loading / empty / error states |
| `/feed` | Analyzed articles | Rows expand in place; sentiment filter; cursor paging |

Two pages, not three. A single-analysis page would render exactly what an expanded
feed row already shows.

UI is plain CSS with custom-property tokens and a system font stack. No component or
styling library — this is a stated requirement.

## API

Base path `/api/v1`. Every payload is defined in `api-contract/`.

| Method | Path | Purpose | Success | Errors |
| --- | --- | --- | --- | --- |
| `GET` | `/articles?q=&lang=&limit=` | Search the news provider, annotated with `analysisId` where already analyzed | 200 | 400, 429, 502 |
| `POST` | `/analyses` | Analyze an article; replaces any previous result for that URL | 201 | 400, 429, 502 |
| `GET` | `/analyses?limit=&cursor=&sentiment=` | The feed, newest first | 200 | 400 |
| `DELETE` | `/analyses/:id` | Remove an analysis from the feed | 204 | 404 |
| `GET` | `/health` | Liveness | 200 | — |

`DELETE` removes only the analysis. The article row stays as a cache, so
re-analyzing that URL reuses it, and search correctly offers "Analyze" again because
the lookup joins through `analyses`.

There is no `GET /analyses/:id`. The list response already carries each analysis in
full, so a fetch-one endpoint would have no caller.

`q` is required on `/articles`: there is no "all news" collection to return.

The GNews free tier delays articles by 12 hours and truncates `content` to roughly
200 characters, so "recent" means the last day rather than the last hour, and a
summary describes the excerpt it was given.

Every failure uses one envelope — `{ error: { code, message, details?, requestId } }`
— so a client writes one handler rather than branching on status codes.

## Data model

Two tables. See `backend/src/db/migrations/001_init.sql`.

**`articles`** — snapshot of an article at analysis time. Article data cannot be
re-fetched later: the free news tier allows 100 requests/day and articles drop out of
its window.

```
id  url(unique)  title  description  content  image_url  source_name
published_at  created_at  updated_at
```

**`analyses`** — one per article, `UNIQUE (article_id)`. Re-analyzing replaces.

```
id  article_id(fk,unique)  summary  sentiment(check)  sentiment_score(check)
model  prompt_version  tokens_in  tokens_out  latency_ms  created_at
```

`created_at` is never updated on replace: it is the feed's sort key, and mutating it
would reorder rows underneath someone paginating.

## Stack

Vue 3 + TypeScript (Vite) · Node 22 + Express 5 · PostgreSQL via `postgres.js` with
hand-written SQL · Zod contract shared by both sides · OpenAI `gpt-4.1-nano` with
strict Structured Outputs.

Hosting: one Render service serving both the API and the built SPA, with Postgres on
Neon (Render's free Postgres deletes itself 30 days after creation).

## Delivery

Seven PRs, each independently reviewable.

| # | Branch | Contents | Status |
| --- | --- | --- | --- |
| 1 | `chore/scaffold-workspace` | Workspaces, tsconfig, Docker Postgres, secrets handling | merged |
| 2 | `feat/api-contract` | Zod schemas for every payload | merged |
| 3 | `feat/db-layer` | Schema, migrations, repositories | merged |
| 4 | `feat/providers` | GNews + OpenAI behind swappable interfaces | merged |
| 5 | `feat/rest-api` | Express 5, controllers, middleware, error envelope | in review |
| 6 | `feat/web-client` | Vue 3 SPA | |
| 7 | `chore/deploy` | Serve SPA from Express, Neon + Render, README | |
