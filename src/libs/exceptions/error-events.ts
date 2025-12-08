/**
 * Error Events - Published when errors occur to trigger error handlers
 * Similar to domain events but for error scenarios
 */

import { BaseException } from "./base.exception";

export interface ErrorEventContext {
  correlationId?: string;
  userId?: string;
  requestPath?: string;
  requestMethod?: string;
  timestamp: string;
}

/**
 * Base error event - all error events extend this
 */
export abstract class ErrorEvent {
  constructor(
    public readonly error: BaseException,
    public readonly context: ErrorEventContext,
    public readonly isCritical: boolean = false,
  ) {}
}

/**
 * Published when a payment operation fails
 */
export class PaymentErrorEvent extends ErrorEvent {
  constructor(
    error: BaseException,
    context: ErrorEventContext,
    public readonly paymentId: string,
    public readonly amount: number,
    public readonly accountId?: string,
  ) {
    super(error, context, true); // Critical: Payments involve money
  }
}

/**
 * Published when a database connection error occurs
 */
export class DatabaseConnectionErrorEvent extends ErrorEvent {
  constructor(
    error: BaseException,
    context: ErrorEventContext,
    public readonly database: string,
  ) {
    super(error, context, true); // Critical: Infrastructure failure
  }
}

/**
 * Published when an external service fails
 */
export class ExternalServiceErrorEvent extends ErrorEvent {
  constructor(
    error: BaseException,
    context: ErrorEventContext,
    public readonly serviceName: string,
    public readonly operation: string,
  ) {
    super(error, context, false); // Not critical by default (can retry)
  }
}

/**
 * Published when a concurrency conflict occurs
 */
export class ConcurrencyErrorEvent extends ErrorEvent {
  constructor(
    error: BaseException,
    context: ErrorEventContext,
    public readonly aggregateId: string,
    public readonly attemptedVersion: number,
  ) {
    super(error, context, false); // Not critical (user can retry)
  }
}
