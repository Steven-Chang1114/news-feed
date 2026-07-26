# news-feed

Search recent news, run an LLM over an article you pick to get a summary and a
sentiment score, and build up a personal digest you can scan by mood.

> **Status:** in progress. This repo is being built as a sequence of reviewable PRs —
> see [Roadmap](#roadmap).

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Vue 3 + TypeScript (Vite) | `<script setup>` + typed props; no component or styling library — the UI is deliberately plain CSS |
| Backend | Node 22 + Express 5 + TypeScript | Express 5 propagates async errors to the error middleware natively, which removes the `asyncHandler` wrapper Express 4 needed |
| Database | PostgreSQL | Enforces a closed sentiment set at the storage layer, `jsonb` for raw provider payloads, `RETURNING` for single-round-trip upserts |
| DB access | `postgres.js` + hand-written SQL | Small query surface; no abstraction between the code and the query plan. All SQL is confined to the repository layer |
| Contract | Zod schemas in `shared/` | Server validates against them, client infers types from them — a response-shape change becomes a frontend compile error |
| AI | OpenAI `gpt-4.1-nano`, strict Structured Outputs | A JSON Schema the model cannot violate, so malformed output is designed out rather than parsed around |

### Why no ORM

The query surface here is roughly eight queries. An ORM would add a dependency, a
build step, and a layer of indirection in exchange for type inference we can get
most of by other means. Instead:

- All SQL lives in `server/src/db/repositories/` — never in a route handler or service.
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
docker compose up -d   # local Postgres on :5432
npm run db:migrate
npm run dev            # API on :3000, web on :5173
```

Get a free news API key at [gnews.io](https://gnews.io) (100 requests/day).

> **Secrets:** `.env` is gitignored and must never be committed. In production these
> are set as environment variables on the host, not in a file.

## Layout

```
shared/   Zod schemas — the API contract, imported by both sides
server/   Express 5 API, providers, repositories, migrations
web/      Vue 3 single-page app
```

## Roadmap

- [x] Workspace scaffold, tooling, local Postgres
- [ ] Shared API contract
- [ ] Database schema, migrations, repositories
- [ ] GNews + OpenAI providers behind swappable interfaces
- [ ] REST API
- [ ] Vue 3 client
- [ ] Deploy + architecture notes
