import { z } from 'zod';

/**
 * One error envelope for every failure, so a client writes one handler.
 *
 * `code` is stable and machine-readable, and clients switch on it. `message` is
 * safe to show a user and may be reworded freely. `requestId` is what a user quotes
 * in a bug report and what ties their failure to a log line.
 */
export const ERROR_CODES = [
  /** Request failed schema validation. 400. */
  'VALIDATION_ERROR',
  /** No such resource. 404. */
  'NOT_FOUND',
  /** Client exceeded a rate limit. 429. */
  'RATE_LIMITED',
  /** A third party (news provider, OpenAI) failed or timed out. 502. */
  'UPSTREAM_ERROR',
  /** Anything unhandled. 500. */
  'INTERNAL_ERROR',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    /** Field-level validation problems. Omitted for internal errors, which never echo details. */
    details: z.unknown().optional(),
    requestId: z.string(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
