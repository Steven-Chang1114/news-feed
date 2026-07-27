/**
 * The API contract: every payload that crosses the network between frontend and
 * backend, defined once.
 *
 * The backend validates incoming requests against these schemas and the frontend
 * infers its types from them, so a change to a response shape is a compile error in
 * the client rather than a runtime surprise.
 *
 * Naming:
 *
 *   list<Resource>Query      query parameters for a GET collection
 *   list<Resource>Response   body of a GET collection
 *   create<Resource>Request  body of a POST
 *
 * Identifiers use American spellings ("analyze").
 */
export * from './article';
export * from './analysis';
export * from './error';
