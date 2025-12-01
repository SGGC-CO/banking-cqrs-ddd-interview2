# Error Handling Improvements for Command Handlers

## Current Issues

### 1. ❌ Generic Error Types
```typescript
// Current - all errors are generic
throw new Error("Account not found");
throw new Error("Insufficient funds");
throw new Error("Deposit amount must be positive");
```
**Problems:**
- Can't distinguish error types programmatically
- No proper HTTP status code mapping
- Hard to handle errors differently based on type
- No error codes for API consumers

### 2. ❌ No Domain Exception Hierarchy
```typescript
// Domain layer throws generic errors
if (amount <= 0) throw new Error("Deposit amount must be positive");
if (this._balance < amount) throw new Error("Insufficient funds");
```
**Problems:**
- Domain errors can't be properly categorized
- Business rules violations mixed with validation errors
- No separation between recoverable and non-recoverable errors

### 3. ❌ Missing Error Context
```typescript
throw new Error("Account not found"); // Which account? What command?
```
**Problems:**
- No context for debugging
- Hard to trace errors in logs
- No correlation IDs

### 4. ❌ No Structured Error Responses
```typescript
// Generic error response
{
  "message": "Account not found"
}
```
**Problems:**
- Inconsistent error format
- Missing error codes
- No helpful details for API consumers

---

## Proposed Solution

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│ Domain Layer (Aggregates)                               │
│ • Throws DomainException subclasses                     │
│ • Business rule violations                              │
└──────────────────┬──────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────┐
│ Application Layer (Handlers)                            │
│ • Catches DomainException                               │
│ • Maps to ApplicationException                          │
│ • Adds context (accountId, command details)             │
└──────────────────┬──────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────┐
│ Infrastructure Layer (Filters)                          │
│ • Global Exception Filters                              │
│ • Maps exceptions to HTTP status codes                  │
│ • Logs errors with context                              │
│ • Returns structured error responses                    │
└──────────────────┬──────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────┐
│ HTTP Layer (Controllers)                                │
│ • Receives properly formatted errors                    │
│ • Returns consistent error responses                    │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation

### 1. Domain Exception Classes

Create specific exception types for domain errors:

```typescript
// src/libs/errors/domain-exceptions.ts

export abstract class DomainException extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;
  
  constructor(
    message: string,
    public readonly details?: Record<string, any>
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Account-related exceptions
export class AccountNotFoundError extends DomainException {
  readonly code = 'ACCOUNT_NOT_FOUND';
  readonly statusCode = 404;
  
  constructor(accountId: string) {
    super(`Account with ID ${accountId} not found`, { accountId });
  }
}

export class InsufficientFundsError extends DomainException {
  readonly code = 'INSUFFICIENT_FUNDS';
  readonly statusCode = 400;
  
  constructor(
    accountId: string,
    public readonly currentBalance: number,
    public readonly requestedAmount: number
  ) {
    super(
      `Insufficient funds. Current balance: ${currentBalance}, Requested: ${requestedAmount}`,
      { accountId, currentBalance, requestedAmount }
    );
  }
}

export class InvalidAmountError extends DomainException {
  readonly code = 'INVALID_AMOUNT';
  readonly statusCode = 400;
  
  constructor(
    public readonly amount: number,
    public readonly reason: 'NEGATIVE' | 'ZERO' | 'TOO_LARGE'
  ) {
    const messages = {
      NEGATIVE: 'Amount cannot be negative',
      ZERO: 'Amount must be greater than zero',
      TOO_LARGE: 'Amount exceeds maximum allowed'
    };
    super(messages[reason], { amount, reason });
  }
}

export class AccountAlreadyExistsError extends DomainException {
  readonly code = 'ACCOUNT_ALREADY_EXISTS';
  readonly statusCode = 409;
  
  constructor(accountId: string) {
    super(`Account with ID ${accountId} already exists`, { accountId });
  }
}

export class InvalidInitialBalanceError extends DomainException {
  readonly code = 'INVALID_INITIAL_BALANCE';
  readonly statusCode = 400;
  
  constructor(public readonly balance: number) {
    super(`Initial balance cannot be negative: ${balance}`, { balance });
  }
}
```

### 2. Update Domain Layer (Aggregates)

Replace generic errors with domain exceptions:

```typescript
// src/modules/accounts/domain/aggregates/account.aggregate.ts

import { 
  InsufficientFundsError, 
  InvalidAmountError, 
  InvalidInitialBalanceError 
} from '../../../../libs/errors/domain-exceptions';

export class Account extends AggregateRoot {
  // ...

  static open(id: string, ownerId: string, currency: string, initialBalance: number) {
    if (initialBalance < 0) {
      throw new InvalidInitialBalanceError(initialBalance);
    }
    // ...
  }

  deposit(amount: number) {
    if (amount <= 0) {
      throw new InvalidAmountError(amount, amount === 0 ? 'ZERO' : 'NEGATIVE');
    }
    this.apply(new DepositedEvent(this.id!, amount));
  }

  withdraw(amount: number) {
    if (amount <= 0) {
      throw new InvalidAmountError(amount, amount === 0 ? 'ZERO' : 'NEGATIVE');
    }
    if (this._balance < amount) {
      throw new InsufficientFundsError(this.id!, this._balance, amount);
    }
    this.apply(new WithdrawnEvent(this.id!, amount));
  }
}
```

### 3. Update Handlers with Error Context

```typescript
// src/modules/accounts/application/handlers/deposit.handler.ts

import { AccountNotFoundError } from '../../../../libs/errors/domain-exceptions';

export class DepositHandler extends ResilientCommandHandler<...> {
  protected async executeInternal(cmd: DepositCommand) {
    try {
      const acc = await this.repo.getById(cmd.accountId);
      if (!acc) {
        throw new AccountNotFoundError(cmd.accountId);
      }

      acc.deposit(cmd.amount);
      await this.repo.save(acc);

      return { accountId: cmd.accountId };
    } catch (error) {
      // Re-throw domain exceptions as-is
      if (error instanceof DomainException) {
        throw error;
      }
      // Wrap unexpected errors
      throw new UnexpectedError('Failed to process deposit', { 
        accountId: cmd.accountId, 
        amount: cmd.amount,
        originalError: error 
      });
    }
  }
}
```

### 4. Application-Level Exception with Context

```typescript
// src/libs/errors/application-exceptions.ts

export class ApplicationException extends Error {
  constructor(
    message: string,
    public readonly domainException: DomainException,
    public readonly context?: Record<string, any>
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class UnexpectedError extends Error {
  readonly code = 'UNEXPECTED_ERROR';
  readonly statusCode = 500;
  
  constructor(
    message: string,
    public readonly context?: Record<string, any>,
    public readonly originalError?: any
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}
```

### 5. Global Exception Filters

```typescript
// src/libs/errors/domain-exception.filter.ts

import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { DomainException } from './domain-exceptions';

@Catch(DomainException)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    const status = exception.statusCode || HttpStatus.BAD_REQUEST;

    // Log error with context
    console.error(`[${exception.code}] ${exception.message}`, {
      code: exception.code,
      statusCode: status,
      path: request.url,
      method: request.method,
      details: exception.details,
      timestamp: new Date().toISOString(),
    });

    response.status(status).json({
      error: {
        code: exception.code,
        message: exception.message,
        details: exception.details,
      },
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
```

```typescript
// src/libs/errors/unexpected-error.filter.ts

import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { UnexpectedError } from './application-exceptions';

@Catch(UnexpectedError)
export class UnexpectedErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(UnexpectedErrorFilter.name);

  catch(exception: UnexpectedError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    // Log full error details for debugging
    this.logger.error(
      `Unexpected error: ${exception.message}`,
      {
        context: exception.context,
        originalError: exception.originalError,
        stack: exception.stack,
        path: request.url,
        method: request.method,
      }
    );

    // Don't expose internal details to client
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred. Please try again later.',
      },
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
```

```typescript
// src/libs/errors/generic-error.filter.ts

import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';

@Catch(Error)
export class GenericErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(GenericErrorFilter.name);

  catch(exception: Error, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    // Log generic errors
    this.logger.error(
      `Unhandled error: ${exception.message}`,
      {
        stack: exception.stack,
        path: request.url,
        method: request.method,
      }
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      },
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
```

### 6. Register Filters in main.ts

```typescript
// src/main.ts

import { DomainExceptionFilter } from './libs/errors/domain-exception.filter';
import { UnexpectedErrorFilter } from './libs/errors/unexpected-error.filter';
import { GenericErrorFilter } from './libs/errors/generic-error.filter';
import { CircuitBreakerExceptionFilter } from './libs/resilience/circuit-breaker.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Register exception filters in order (most specific first)
  app.useGlobalFilters(
    new CircuitBreakerExceptionFilter(),  // Catch circuit breaker errors
    new DomainExceptionFilter(),          // Catch domain exceptions
    new UnexpectedErrorFilter(),          // Catch application exceptions
    new GenericErrorFilter(),             // Catch-all for any Error
  );
  
  // ...
}
```

---

## Benefits

### ✅ Type Safety
```typescript
// Can check error type programmatically
catch (error) {
  if (error instanceof InsufficientFundsError) {
    // Handle insufficient funds specifically
    console.log(`Balance: ${error.currentBalance}, Requested: ${error.requestedAmount}`);
  }
}
```

### ✅ Proper HTTP Status Codes
- `404` for AccountNotFoundError
- `400` for InvalidAmountError, InsufficientFundsError
- `409` for AccountAlreadyExistsError
- `503` for CircuitBreakerError
- `500` for unexpected errors

### ✅ Structured Error Responses
```json
{
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "Insufficient funds. Current balance: 50, Requested: 100",
    "details": {
      "accountId": "abc-123",
      "currentBalance": 50,
      "requestedAmount": 100
    }
  },
  "timestamp": "2024-01-15T10:30:00Z",
  "path": "/accounts/abc-123/withdraw"
}
```

### ✅ Better Logging
```typescript
// Logs include full context
[INSUFFICIENT_FUNDS] Insufficient funds. Current balance: 50, Requested: 100 {
  code: 'INSUFFICIENT_FUNDS',
  statusCode: 400,
  path: '/accounts/abc-123/withdraw',
  method: 'POST',
  details: { accountId: 'abc-123', currentBalance: 50, requestedAmount: 100 },
  timestamp: '2024-01-15T10:30:00Z'
}
```

### ✅ Error Codes for API Consumers
Clients can programmatically handle specific error types:
```typescript
if (response.error.code === 'INSUFFICIENT_FUNDS') {
  showInsufficientFundsDialog(response.error.details.currentBalance);
}
```

---

## Example: Complete Flow

### Before (Current)
```typescript
// Handler throws generic error
throw new Error("Account not found");

// Returns generic 500 error
{
  "statusCode": 500,
  "message": "Account not found"
}
```

### After (Improved)
```typescript
// Handler throws domain exception
throw new AccountNotFoundError(cmd.accountId);

// Filter catches and returns structured 404 error
{
  "error": {
    "code": "ACCOUNT_NOT_FOUND",
    "message": "Account with ID abc-123 not found",
    "details": {
      "accountId": "abc-123"
    }
  },
  "timestamp": "2024-01-15T10:30:00Z",
  "path": "/accounts/abc-123/deposit"
}
```

---

## Migration Strategy

1. **Phase 1**: Create exception classes and filters
2. **Phase 2**: Update domain layer (aggregates) to use domain exceptions
3. **Phase 3**: Update handlers to use domain exceptions
4. **Phase 4**: Register filters globally
5. **Phase 5**: Update API documentation with error codes

---

## Additional Improvements

### 1. Validation Errors
```typescript
export class ValidationException extends DomainException {
  readonly code = 'VALIDATION_ERROR';
  readonly statusCode = 400;
  
  constructor(public readonly violations: ValidationViolation[]) {
    super('Validation failed', { violations });
  }
}

interface ValidationViolation {
  field: string;
  message: string;
  value?: any;
}
```

### 2. Concurrency Errors
```typescript
export class ConcurrencyError extends DomainException {
  readonly code = 'CONCURRENCY_CONFLICT';
  readonly statusCode = 409;
  
  constructor(
    aggregateId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number
  ) {
    super(
      `Version conflict. Expected: ${expectedVersion}, Actual: ${actualVersion}`,
      { aggregateId, expectedVersion, actualVersion }
    );
  }
}
```

### 3. Error Correlation IDs
```typescript
// Add correlation ID to track requests across services
export class ErrorResponse {
  error: {
    code: string;
    message: string;
    correlationId: string; // ← Add this
    details?: Record<string, any>;
  };
  timestamp: string;
  path: string;
}
```

---

## Summary

| Aspect | Before | After |
|--------|--------|-------|
| **Error Types** | Generic `Error` | Specific domain exceptions |
| **HTTP Status** | Always 500 | Proper status codes (400, 404, 409, 503) |
| **Error Codes** | None | Structured codes (ACCOUNT_NOT_FOUND, etc.) |
| **Error Context** | Minimal | Full context (accountId, amounts, etc.) |
| **Logging** | Basic | Structured with full context |
| **API Documentation** | Not possible | Documentable error codes |
| **Type Safety** | None | Full type checking |

