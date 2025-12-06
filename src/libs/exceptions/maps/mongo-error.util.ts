import { BaseException } from '../base.exception';
import {
  DatabaseConnectionError,
  DatabaseQueryError,
} from '../infrastructure.exceptions';
import { CircuitBreakerError } from '../../resilience/circuit-breaker';

function isMongoConnectionError(error: unknown): boolean {
  const message = (error as Error)?.message || '';

  return (
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    message.includes('connect') ||
    message.includes('MongoServerSelectionError')
  );
}

/**
 * Normalize low-level Mongo or circuit breaker errors into our BaseException hierarchy.
 * This is the single place where Mongo-specific error inspection should live.
 */
export function normalizeMongoError(
  error: unknown,
  operation: string,
  collection: string,
  databaseName = 'MongoDB',
): never {
  // Already a classified application/domain/infrastructure error
  if (error instanceof BaseException) {
    throw error;
  }

  // Preserve circuit breaker semantics
  if (error instanceof CircuitBreakerError) {
    throw error;
  }

  // Technical MongoDB connection issues
  if (isMongoConnectionError(error)) {
    throw new DatabaseConnectionError(databaseName, error as Error);
  }

  // Fallback: generic database query error
  throw new DatabaseQueryError(operation, collection, error as Error);
}

