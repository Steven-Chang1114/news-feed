/**
 * The API contract: every payload that crosses the network between frontend and
 * backend, defined once.
 *
 * The backend validates incoming requests against these schemas; the frontend
 * derives its types from them with `z.infer`. A change to a response shape is
 * therefore a compile error in the client rather than a runtime surprise in
 * production — which is the entire reason this is a package and not a folder of
 * hand-copied interfaces.
 *
 * ---------------------------------------------------------------------------
 * Naming
 * ---------------------------------------------------------------------------
 *
 * One concept can have three shapes, and they are not interchangeable. The name
 * says which one you are holding:
 *
 *   AnalysisOutput   what the model returns    no id, no provenance, not yet ours
 *   Analysis         what the API returns      the wire resource, id + nested article
 *   AnalysisRow      what a database row holds FKs, token counts, latency, raw payloads
 *
 * The rules:
 *
 *   1. Everything exported from this package is a wire type. The resource itself
 *      takes no suffix (`Article`, `Analysis`); wrappers state what they are
 *      (`ListAnalysesResponse`, `CreateAnalysisRequest`).
 *
 *   2. Database row types are suffixed `Row`, live in `backend/src/db`, and are
 *      never exported from here. This package must stay ignorant of storage — it
 *      describes the wire, and the wire is not the schema.
 *
 *   3. `Row` types never escape the repository layer. Mapping `Row` -> wire type
 *      is precisely a repository's job. An `AnalysisRow` in a route handler means
 *      a boundary has leaked.
 *
 *   4. Model input/output is suffixed `Output` / `Input`.
 *
 * Endpoint schemas follow the shape of the endpoint, so the surface is
 * predictable without looking it up:
 *
 *   list<Resource>Query      query parameters for a GET collection
 *   list<Resource>Response   body of a GET collection
 *   create<Resource>Request  body of a POST
 *
 * Identifiers use American spellings ("analyze") throughout.
 */
export * from './article';
export * from './analysis';
export * from './error';
