import { BaseException } from './base.exception';

/**
 * Base class for all domain exceptions.
 * These represent business rule violations.
 */
export abstract class DomainException extends BaseException {
  readonly isOperational = true; // Domain errors are expected
}

// ==================== Account Domain Exceptions ====================

export class AccountNotFoundError extends DomainException {
  readonly code = 'ACCOUNT_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(accountId: string) {
    super(`Account not found: ${accountId}`, { accountId });
  }
}

export class AccountAlreadyExistsError extends DomainException {
  readonly code = 'ACCOUNT_ALREADY_EXISTS';
  readonly httpStatus = 409;

  constructor(accountId: string) {
    super(`Account already exists: ${accountId}`, { accountId });
  }
}

export class InsufficientFundsError extends DomainException {
  readonly code = 'INSUFFICIENT_FUNDS';
  readonly httpStatus = 422;

  constructor(accountId: string, requested: number, available: number) {
    super(
      `Insufficient funds: requested ${requested}, available ${available}`,
      { accountId, requested, available }
    );
  }
}

export class AccountClosedError extends DomainException {
  readonly code = 'ACCOUNT_CLOSED';
  readonly httpStatus = 422;

  constructor(accountId: string) {
    super(`Cannot perform operation on closed account: ${accountId}`, { accountId });
  }
}

export class InvalidAmountError extends DomainException {
  readonly code = 'INVALID_AMOUNT';
  readonly httpStatus = 400;

  constructor(amount: number, reason: string) {
    super(`Invalid amount: ${amount}. ${reason}`, { amount, reason });
  }
}

export class DailyLimitExceededError extends DomainException {
  readonly code = 'DAILY_LIMIT_EXCEEDED';
  readonly httpStatus = 422;

  constructor(accountId: string, limit: number, attempted: number) {
    super(
      `Daily transaction limit exceeded`,
      { accountId, limit, attempted }
    );
  }
}

export class ConcurrencyError extends DomainException {
  readonly code = 'CONCURRENCY_CONFLICT';
  readonly httpStatus = 409;

  constructor(aggregateId: string, expectedVersion: number) {
    super(
      `Concurrency conflict: aggregate was modified`,
      { aggregateId, expectedVersion }
    );
  }
}

export class InvalidCurrencyError extends DomainException {
  readonly code = 'INVALID_CURRENCY';
  readonly httpStatus = 400;

  constructor(currency: string, supportedCurrencies: string[]) {
    super(
      `Invalid currency: ${currency}`,
      { currency, supportedCurrencies }
    );
  }
}

