import { BaseException } from './base.exception';

/**
 * Base class for infrastructure exceptions.
 * These represent technical failures.
 */
export abstract class InfrastructureException extends BaseException {
  readonly isOperational = false; // Infrastructure errors may indicate bugs
}

// ==================== Database Exceptions ====================

export class DatabaseConnectionError extends InfrastructureException {
  readonly code = 'DATABASE_CONNECTION_ERROR';
  readonly httpStatus = 503;
  public readonly retryAfterMs: number;

  constructor(database: string, cause?: Error, retryAfterMs: number = 10000) {
    super(
      `Failed to connect to database: ${database}`,
      { database },
      cause
    );
    this.retryAfterMs = retryAfterMs;
  }
}

export class DatabaseQueryError extends InfrastructureException {
  readonly code = 'DATABASE_QUERY_ERROR';
  readonly httpStatus = 500;

  constructor(operation: string, collection: string, cause?: Error) {
    super(
      `Database query failed: ${operation} on ${collection}`,
      { operation, collection },
      cause
    );
  }
}

export class DatabaseTimeoutError extends InfrastructureException {
  readonly code = 'DATABASE_TIMEOUT';
  readonly httpStatus = 504;

  constructor(operation: string, timeoutMs: number, cause?: Error) {
    super(
      `Database operation timed out after ${timeoutMs}ms`,
      { operation, timeoutMs },
      cause
    );
  }
}

// ==================== Circuit Breaker Exceptions ====================

export class CircuitBreakerOpenError extends InfrastructureException {
  readonly code = 'CIRCUIT_BREAKER_OPEN';
  readonly httpStatus = 503;

  constructor(
    serviceName: string,
    public readonly retryAfterMs: number = 10000
  ) {
    super(
      `Service temporarily unavailable: ${serviceName}`,
      { serviceName, retryAfterMs }
    );
  }
}

// ==================== Cache Exceptions ====================

export class CacheConnectionError extends InfrastructureException {
  readonly code = 'CACHE_CONNECTION_ERROR';
  readonly httpStatus = 503;
  public readonly retryAfterMs: number;

  constructor(cacheType: string, cause?: Error, retryAfterMs: number = 10000) {
    super(
      `Failed to connect to cache: ${cacheType}`,
      { cacheType },
      cause
    );
    this.retryAfterMs = retryAfterMs;
  }
}

// ==================== External Service Exceptions ====================

export class ExternalServiceError extends InfrastructureException {
  readonly code = 'EXTERNAL_SERVICE_ERROR';
  readonly httpStatus = 502;

  constructor(serviceName: string, statusCode: number, cause?: Error) {
    super(
      `External service error: ${serviceName} returned ${statusCode}`,
      { serviceName, statusCode },
      cause
    );
  }
}

export class ExternalServiceTimeoutError extends InfrastructureException {
  readonly code = 'EXTERNAL_SERVICE_TIMEOUT';
  readonly httpStatus = 504;

  constructor(serviceName: string, timeoutMs: number, cause?: Error) {
    super(
      `External service timed out: ${serviceName} after ${timeoutMs}ms`,
      { serviceName, timeoutMs },
      cause
    );
  }
}

// ==================== Message Queue Exceptions ====================

export class MessageQueueError extends InfrastructureException {
  readonly code = 'MESSAGE_QUEUE_ERROR';
  readonly httpStatus = 503;
  public readonly retryAfterMs: number;

  constructor(queue: string, operation: string, cause?: Error, retryAfterMs: number = 10000) {
    super(
      `Message queue error: ${operation} on ${queue}`,
      { queue, operation },
      cause
    );
    this.retryAfterMs = retryAfterMs;
  }
}

