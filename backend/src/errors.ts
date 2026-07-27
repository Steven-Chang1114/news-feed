import type { ErrorCode } from '@news-feed/api-contract';

/**
 * An error with a place in the API's error envelope.
 *
 * Carrying the code and status here means the HTTP layer translates rather than
 * classifies: anything that is not an `AppError` is an unhandled bug and becomes a
 * 500 with no details echoed to the client.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    options: { cause?: unknown; details?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = options.details;
  }
}

/** The request failed schema validation. `details` carries the field-level problems. */
export function validationError(details: unknown): AppError {
  return new AppError('VALIDATION_ERROR', 'The request is invalid', 400, { details });
}

/** No such resource. */
export function notFoundError(message: string): AppError {
  return new AppError('NOT_FOUND', message, 404);
}

/** A third party failed, timed out, or answered in a shape we cannot use. */
export function upstreamError(message: string, cause?: unknown): AppError {
  return new AppError('UPSTREAM_ERROR', message, 502, { cause });
}

/** A third party refused us for quota reasons; retrying immediately will not help. */
export function rateLimitedError(message: string, cause?: unknown): AppError {
  return new AppError('RATE_LIMITED', message, 429, { cause });
}
