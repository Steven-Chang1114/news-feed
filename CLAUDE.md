# Conventions and working agreement

Rules for changing this codebase. The project itself — scope, user flow, endpoints,
data model, delivery plan — is in [docs/PLAN.md](docs/PLAN.md), which is the source
of truth for what gets built.

This file lives at the repository root because that is where it is loaded from
automatically. Moving it elsewhere means it stops being read.

## Working agreement

**Do not change code unless it is confirmed first.** Propose the change, wait for a
yes, then write it. This applies to source, tests, schemas and config. Updating
`CLAUDE.md`, `README.md` and `docs/` when explicitly asked is exempt.

**Scope discipline.** If the brief does not ask for it and no existing code needs it,
it does not ship. Name the line in the spec or the existing code that requires a new
field, module or abstraction; if there is none, do not build it.

**Never make production code longer to accommodate a test.** Tests adapt to the
code, not the other way round. A wrapper, an extra type or an injected function
added so a test is easier to write is a cost paid by every future reader for a
convenience only the test enjoys. Keeping the network out of a test is a real
requirement; the smallest thing that achieves it wins, and a cast in the test file
is cheaper than an abstraction in the source.

**Before adding an abstraction, name the second implementation.** If it cannot be
named, and will not exist, do not add the seam. A test fake counts once — two seams
serving the same fake means one of them is redundant.

**Simplicity is the default.** When two designs work, ship the shorter one.

## Type naming

One concept, three shapes:

```
AnalysisOutput           what the model returns     no id, no provenance
AnalysisResponse         what the API returns       output + id, article, provenance
AnalysisWithArticleRow   what a query returns       flat, Date objects not ISO strings
```

- **Anything the API returns ends in `Response`** — `AnalysisResponse`,
  `ListAnalysesResponse`, `ErrorResponse`. Anything it accepts ends in `Request` or
  `Query`.
- A query has two derived views of one schema: `ListAnalysesQuery` (`z.input`) is
  what a client may send, since a query string is text; `ParsedListAnalysesQuery`
  (`z.output`) is what server code holds once coerced and defaulted. Two names, one
  schema — nothing is restated.
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
import it. If it is the contract's type plus fields, `extend` it. If it is a schema's
parsed output, derive it with `z.infer`. Only declare a distinct type where the
shapes can genuinely diverge — storage rows do, because they carry `Date` objects and
internal columns the wire never sees.

## Structure

**Directories** are named for the role they play: `frontend`, `backend`,
`api-contract`.

**Imports** use the package name across workspaces (`@news-feed/api-contract`) and
relative paths within one (`./prompt`, `../errors`).

**SQL** lives only in `backend/src/db/repositories/`. Never in a route or a service.

**Transactions** are opened in the service layer only. Repositories take whichever
handle they are given and never open one; inside a transaction every query must go
through `tx`, and provider calls stay outside it.

**Third parties** sit behind an interface in `backend/src/providers/`, with the
vendor SDK confined to a single adapter file, so tests need no key and no network.

## Comments

Comments carry the reasoning for anything non-obvious — this codebase has to be
defended out loud, without AI, in the next round. State why the code is the way it
is, in the present tense. Never narrate how a decision was reached, argue against
alternatives that were considered, or reference reviews and revisions. The same
applies to every markdown file: they describe the project, not the process of
building it.

## Before opening any PR

- [ ] `npm run typecheck` clean
- [ ] `npm test` passing, and new behaviour has a test
- [ ] **Feature table in `docs/PLAN.md` updated** — statuses reflect what landed
- [ ] **Delivery table in `docs/PLAN.md` updated** — this PR's row marked
- [ ] **`README.md` roadmap checkboxes updated** to match
- [ ] Anything cut or deferred written into *Explicitly out of scope*, not just dropped
- [ ] No secret in the diff (`git diff --cached | grep -iE 'sk-|api[_-]?key'`)
- [ ] Claims in the PR description verified by running something, not assumed
- [ ] Committing to a branch, never to `main`
