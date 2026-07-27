import { randomUUID } from 'node:crypto';
import type { ErrorResponse } from '@news-feed/api-contract';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../errors';

/**
 * Gives every request an id and echoes it in a header, so a user reporting a failure
 * can quote the same string that appears in the logs.
 */
export const requestId: RequestHandler = (_req, res, next) => {
  res.locals.requestId = randomUUID();
  res.setHeader('X-Request-Id', String(res.locals.requestId));
  next();
};

/**
 * Translates errors into the one envelope every failure uses. It classifies nothing:
 * an `AppError` already knows its code and status, and anything else is an unhandled
 * bug, which becomes a 500 whose details never reach the client.
 *
 * Express 5 routes async rejections here on its own, so route handlers need no
 * try/catch and no wrapper.
 */
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const requestId = String(res.locals.requestId ?? 'unknown');

  if (error instanceof AppError) {
    const body: ErrorResponse = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
        requestId,
      },
    };
    res.status(error.status).json(body);
    return;
  }

  console.error(`[${requestId}] unhandled error`, error);

  const body: ErrorResponse = {
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId },
  };
  res.status(500).json(body);
};

/** Unknown paths get the same envelope rather than Express's HTML default. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ErrorResponse = {
    error: {
      code: 'NOT_FOUND',
      message: 'No such endpoint',
      requestId: String(res.locals.requestId ?? 'unknown'),
    },
  };
  res.status(404).json(body);
};
