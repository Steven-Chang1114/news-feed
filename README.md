# news-feed

Search recent news, run an LLM over an article you pick to get a summary and a
sentiment score, and build up a personal digest you can scan by mood.

> Built as a sequence of reviewable PRs. Full scope, user flow, API and data model
> are in [docs/PLAN.md](docs/PLAN.md).

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Vue 3 + TypeScript (Vite) | `<script setup>` + typed props; no component or styling library — the UI is deliberately plain CSS |
| Backend | Node 22 + Express 5 + TypeScript | Express 5 propagates async errors to the error middleware natively, which removes the `asyncHandler` wrapper Express 4 needed |
| Database | PostgreSQL | Enforces a closed sentiment set at the storage layer, and `RETURNING` makes an upsert a single round trip |
| DB access | `postgres.js` + hand-written SQL | Small query surface; no abstraction between the code and the query plan. All SQL is confined to the repository layer |
| Contract | Zod schemas in `api-contract/` | Server validates against them, client infers types from them — a response-shape change becomes a frontend compile error |
| AI | OpenAI `gpt-4.1-nano`, strict Structured Outputs | A JSON Schema the model cannot violate, so malformed output is designed out rather than parsed around |

### Why no ORM

The query surface here is roughly eight queries. An ORM would add a dependency, a
build step, and a layer of indirection in exchange for type inference we can get
most of by other means. Instead:

- All SQL lives in `backend/src/db/repositories/` — never in a controller or service.
  Services depend on a repository *interface*, which is what keeps them testable.
- `postgres.js` tagged templates are parameterised by the driver (`` sql`WHERE id = ${id}` ``
  sends `$1`), so injection is prevented structurally, not by discipline.
- `transform: postgres.camel` maps `created_at` → `createdAt` at the driver level.
- Migrations are numbered, immutable `.sql` files applied by a small runner that
  records what it has applied.

The honest cost: a row type is a *claim*, not a compile-time check — rename a column
and TypeScript won't notice. That's covered by an integration test which executes
every repository query against a real migrated database, so schema drift fails the
build instead of production.

## Quickstart

Requires Node 22+ and Docker (for local Postgres).

```bash
npm install
cp .env.example .env   # then fill in GNEWS_API_KEY and OPENAI_API_KEY
docker compose up -d --wait   # local Postgres on :5432; --wait blocks until it accepts connections
npm run db:migrate
npm run dev                   # backend on :3000, frontend on :5173
```

Get a free news API key at [gnews.io](https://gnews.io) (100 requests/day).

> **Secrets:** `.env` is gitignored and must never be committed. In production only
> `GNEWS_API_KEY` and `OPENAI_API_KEY` are set by hand, in the Render dashboard;
> `DATABASE_URL` is injected from the database in the blueprint.

## Tests

```bash
npm run typecheck
npm test
```

The repository tests execute every query against a real database, so they need one
of their own:

```bash
docker exec news-feed-postgres psql -U newsfeed -d postgres -c "CREATE DATABASE newsfeed_test"
```

`TEST_DATABASE_URL` is deliberately separate from `DATABASE_URL`, because these
tests drop and recreate every table — aiming them at a real database by accident
should be impossible rather than unlikely. Unset, they report as skipped rather than
passing silently.

## Layout

```
api-contract/   Zod schemas defining every payload that crosses the network
backend/        Express 5 API, providers, repositories, migrations
frontend/       Vue 3 single-page app
```

## Hosting

| Piece | Where | Notes |
| --- | --- | --- |
| Frontend + backend | Single Render service | Express serves the built Vue app, so one origin and no CORS in production |
| Database | Render Postgres | Declared in the same blueprint, so `DATABASE_URL` is injected rather than copied, and the database is reached over Render's private network |

Two free-tier behaviours to be aware of, both expected rather than broken:

- Render spins a free service down after ~15 minutes idle, so the first request
  after a quiet period can take 30–60s.
- **A free database is deleted 30 days after it is created**, with a 14-day grace
  period to upgrade. Upgrading is a plan change in the dashboard and needs no
  redeploy.

### Deploying

1. In [Render](https://render.com), create a Blueprint from this repository.
   `render.yaml` provisions the web service and its database together; the build
   runs `npm ci && npm run build` and the start command applies migrations before
   serving.
2. Set two environment variables in the Render dashboard, where they are stored
   encrypted: `GNEWS_API_KEY` and `OPENAI_API_KEY`. They are marked `sync: false`
   in the blueprint precisely so they never live in the repository.

`DATABASE_URL` needs no step of its own: Render injects it from the database in the
blueprint, so the connection string is never handled by hand.

`npm run build` produces `frontend/dist` and `backend/dist`; `npm start` migrates,
then serves the API and that built client from one process. Running those two
commands locally reproduces the deployed setup exactly.

## Roadmap

- [x] Workspace scaffold, tooling, local Postgres
- [x] API contract
- [x] Database schema, migrations, repositories
- [x] GNews + OpenAI providers behind swappable interfaces
- [x] REST API
- [x] Vue 3 client
- [x] Deploy + architecture notes
