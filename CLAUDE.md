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
| 5 | Feed listing every analyzed article with its sentiment label, newest first | repo done |
| 6 | Click a feed row to reveal its summary | PR 6 |
| 7 | Filter the feed by sentiment | repo done |
| 8 | Page through the feed | repo done |

### Explicitly out of scope

Cut deliberately, not forgotten. Each was considered and rejected as unasked-for:

- Authentication and multi-user accounts — the brief describes one user
- Batch analysis of several articles at once
- Keeping a history of analyses per article (superseded by feature 4)
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
        summary, rationale, link to the original article, "Re-analyze"
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

UI is plain CSS with custom-property tokens and a system font stack. No component
or styling library — this is a stated requirement.

## API

Base path `/api/v1`. Every payload is defined in `api-contract/`.

| Method | Path | Purpose | Success | Errors |
| --- | --- | --- | --- | --- |
| `GET` | `/articles?q=&lang=&limit=` | Search the news provider, annotated with `analysisId` where already analyzed | 200 | 400, 429, 502 |
| `POST` | `/analyses` | Analyze an article; replaces any previous result for that URL | 201 | 400, 429, 502 |
| `GET` | `/analyses?limit=&cursor=&sentiment=` | The feed, newest first | 200 | 400 |
| `GET` | `/health` | Liveness | 200 | — |

There is no `GET /analyses/:id`. The list response already carries each analysis in
full, so a fetch-one endpoint would have no caller.

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
AnalysisOutput           what the model returns     no id, no provenance
AnalysisResponse         what the API returns       output + id, article, provenance
AnalysisWithArticleRow   what a query returns       flat, Date objects not ISO strings
```

- **Anything the API returns ends in `Response`** — `AnalysisResponse`,
  `ListAnalysesResponse`, `ErrorResponse`. Anything it accepts ends in `Request` or
  `Query`.
- A type used in *both* directions keeps a bare name, and that bareness is the
  signal. `Article` appears inside `CreateAnalysisRequest` and inside
  `AnalysisResponse`, so it belongs to neither. Same for value types like
  `Sentiment`, and for `AnalysisOutput`, which is a model-layer shape and never
  touches HTTP.
- `Row` types live in `backend/src/db/` and never escape the repository layer.
- Repository method `foo` takes `FooParams`; it returns a contract type where one
  fits, and `FooResult` only where none does.
- Identifiers use American spellings (`analyze`).

**Reuse contract types; never restate a shape.** If a type is the contract's type,
import it. If it is the contract's type plus fields, `extend` it. If it is a
schema's parsed output, derive it with `z.infer`. Hand-writing a second copy of a
shape means two places to change and one to forget. Only declare a distinct type
where the shapes can genuinely diverge — storage rows do, because they carry `Date`
objects and internal columns the wire never sees.

**Directories** are named for the role they play: `frontend`, `backend`,
`api-contract`.

**SQL** lives only in `backend/src/db/repositories/`. Never in a route or a service.

**Comments** carry the reasoning for anything non-obvious — this codebase has to be
defended out loud, without AI, in the next round.

**Scope discipline.** If the brief does not ask for it and no existing code needs it,
it does not ship.

## Before opening any PR

Run through this every time. The doc items are here because a plan that silently
goes stale is worse than no plan — a reader trusts it.

- [ ] `npm run typecheck` clean
- [ ] `npm test` passing, and new behaviour has a test
- [ ] **Feature table above updated** — statuses reflect what actually landed
- [ ] **Delivery table below updated** — this PR's row marked
- [ ] **`README.md` roadmap checkboxes updated** to match
- [ ] Anything cut or deferred is written into *Explicitly out of scope*, not just dropped
- [ ] No secret in the diff (`git diff --cached | grep -iE 'sk-|api[_-]?key'`)
- [ ] Claims in the PR description were verified by running something, not assumed

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
