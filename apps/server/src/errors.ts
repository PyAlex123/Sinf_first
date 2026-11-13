import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { ApiError } from '@sinf/shared';

/** HTTP error with a machine-readable code; serialized as `ApiError` from @sinf/shared. */
export class ApiHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: ApiError['details'],
  ) {
    super(message);
    this.name = 'ApiHttpError';
  }
}

export function notFound(message = 'Not found'): ApiHttpError {
  return new ApiHttpError(404, 'not_found', message);
}

export function errorHandler(
  error: FastifyError | ApiHttpError | ZodError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof ApiHttpError) {
    const body: ApiError = { error: error.code, message: error.message };
    if (error.details) body.details = error.details;
    void reply.status(error.statusCode).send(body);
    return;
  }
  if (error instanceof ZodError) {
    const body: ApiError = {
      error: 'validation',
      message: 'Invalid request',
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
    void reply.status(400).send(body);
    return;
  }
  const status =
    'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
  if (status >= 500) {
    request.log.error(error);
  }
  const body: ApiError = {
    error: status === 404 ? 'not_found' : status >= 500 ? 'internal' : 'request',
    message: status >= 500 ? 'Internal server error' : error.message,
  };
  void reply.status(status).send(body);
}
