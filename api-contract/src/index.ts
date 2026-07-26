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
 * Naming convention, applied uniformly so the surface is predictable from the
 * endpoint alone:
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
