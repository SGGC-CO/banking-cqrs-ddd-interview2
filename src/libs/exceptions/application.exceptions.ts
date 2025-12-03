import { BaseException } from './base.exception';

/**
 * Application-level exceptions for command/query handling.
 */
export abstract class ApplicationException extends BaseException {
  readonly isOperational = true;
}

// ==================== Validation Exceptions ====================

export class ValidationError extends ApplicationException {
  readonly code = 'VALIDATION_ERROR';
  readonly httpStatus = 400;

  constructor(errors: ValidationFieldError[]) {
    super(
      'Validation failed',
      { errors }
    );
  }
}

export interface ValidationFieldError {
  field: string;
  message: string;
  value?: any;
}

// ==================== Authentication/Authorization ====================

export class AuthenticationError extends ApplicationException {
  readonly code = 'AUTHENTICATION_ERROR';
  readonly httpStatus = 401;

  constructor(reason: string = 'Authentication required') {
    super(reason);
  }
}

export class AuthorizationError extends ApplicationException {
  readonly code = 'AUTHORIZATION_ERROR';
  readonly httpStatus = 403;

  constructor(resource: string, action: string) {
    super(
      `Not authorized to ${action} ${resource}`,
      { resource, action }
    );
  }
}

// ==================== Rate Limiting ====================

export class RateLimitError extends ApplicationException {
  readonly code = 'RATE_LIMIT_EXCEEDED';
  readonly httpStatus = 429;

  constructor(
    public readonly retryAfterSeconds: number
  ) {
    super(
      `Rate limit exceeded. Retry after ${retryAfterSeconds} seconds`,
      { retryAfterSeconds }
    );
  }
}

// ==================== Idempotency ====================

export class DuplicateRequestError extends ApplicationException {
  readonly code = 'DUPLICATE_REQUEST';
  readonly httpStatus = 409;

  constructor(idempotencyKey: string) {
    super(
      'Duplicate request detected',
      { idempotencyKey }
    );
  }
}

// ==================== Command/Query Exceptions ====================

export class CommandHandlerNotFoundError extends ApplicationException {
  readonly code = 'COMMAND_HANDLER_NOT_FOUND';
  readonly httpStatus = 500;

  constructor(commandName: string) {
    super(
      `No handler registered for command: ${commandName}`,
      { commandName }
    );
  }
}

export class QueryHandlerNotFoundError extends ApplicationException {
  readonly code = 'QUERY_HANDLER_NOT_FOUND';
  readonly httpStatus = 500;

  constructor(queryName: string) {
    super(
      `No handler registered for query: ${queryName}`,
      { queryName }
    );
  }
}

