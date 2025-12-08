# Error Action System Guide

## Overview

The error action system allows you to trigger complex actions when specific errors occur. For example:

- **PaymentError** → Refund user + Send email notification
- **DatabaseConnectionError** → Alert ops team + Update health status
- **ConcurrencyError** → Log conflict + Notify admin

All actions are **automatic**, **async**, and **non-blocking** (won't affect the error response).

---

## Architecture

```
Error Occurs
    ↓
GlobalExceptionFilter catches it
    ↓
ErrorActionService.publishError()
  ↓
Error Event created & published to EventBus
  ↓
Critical? → **ErrorActionQueue (Redis, fallback to in-memory) sequential + retries**
Non-critical? → **Immediate parallel execution** (fire-and-forget)
  ↓
Handlers execute their actions (refund, email, alerts, etc.)
```

---

## How It Works

### 1. Error Events Are Published Automatically

When `GlobalExceptionFilter` catches a `BaseException`, it automatically:

1. Creates an appropriate `ErrorEvent` (if one exists for that error code)
2. Publishes it to the `EventBus`
3. The `ErrorActionService` receives the event and routes it:

- **Critical Events** (e.g., `PaymentError`, `DatabaseConnectionError`) → Sent to **ErrorActionQueue** (Redis for durability, auto-fallback to in-memory) for **sequential, retried execution**.
- **Non-Critical Events** → Executed immediately in parallel (fire-and-forget).

**You don't need to do anything** - errors are automatically routed to handlers.

### 2. Create Error Action Handlers

Create a handler class that implements `ErrorActionHandler`:

```typescript
import { Injectable } from "@nestjs/common";
import { ErrorActionHandler } from "../../../libs/exceptions/error-action.handler";
import {
  PaymentErrorEvent,
  ErrorEvent,
} from "../../../libs/exceptions/error-events";

@Injectable()
export class PaymentErrorHandler implements ErrorActionHandler {
  constructor() // Inject your services
  // private readonly refundService: RefundService,
  // private readonly emailService: EmailService,
  {}

  canHandle(event: ErrorEvent): boolean {
    // Return true if this handler should handle this event
    return event instanceof PaymentErrorEvent;
  }

  async handle(event: PaymentErrorEvent): Promise<void> {
    // Execute your actions here
    // - Refund user
    // - Send email
    // - Log for audit
    // - etc.

    await Promise.allSettled([
      this.refundUser(event),
      this.sendEmail(event),
      this.logAudit(event),
    ]);
  }

  private async refundUser(event: PaymentErrorEvent) {
    // Refund logic
  }

  private async sendEmail(event: PaymentErrorEvent) {
    // Email logic
  }

  private async logAudit(event: PaymentErrorEvent) {
    // Audit logging
  }
}
```

### 3. Register Handlers in Your Module

```typescript
import { Module, OnModuleInit } from "@nestjs/common";
import { ErrorActionService } from "../../../libs/exceptions/error-action.service";
import { PaymentErrorHandler } from "./application/error-handlers/payment-error.handler";

@Module({
  providers: [
    PaymentErrorHandler,
    // ... other providers
  ],
})
export class PaymentsModule implements OnModuleInit {
  constructor(
    private readonly errorActionService: ErrorActionService,
    private readonly paymentErrorHandler: PaymentErrorHandler,
  ) {}

  onModuleInit() {
    // Register handlers when module initializes
    this.errorActionService.registerHandler(this.paymentErrorHandler);
  }
}
```

---

## Example: Complex Payment Error Handler

Here's a complete example that:

1. Refunds the user (Critical - Retried on failure)
2. Sends failure notification email
3. Logs audit trail
4. Notifies ops team

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { ErrorActionHandler } from "../../../libs/exceptions/error-action.handler";
import {
  PaymentErrorEvent,
  ErrorEvent,
} from "../../../libs/exceptions/error-events";

@Injectable()
export class PaymentErrorHandler implements ErrorActionHandler {
  private readonly logger = new Logger(PaymentErrorHandler.name);

  constructor() // Inject your services
  // private readonly refundService: RefundService,
  // private readonly emailService: EmailService,
  // private readonly auditService: AuditService,
  // private readonly alertService: AlertService,
  {}

  canHandle(event: ErrorEvent): boolean {
    return event instanceof PaymentErrorEvent;
  }

  async handle(event: PaymentErrorEvent): Promise<void> {
    this.logger.log(`Handling payment error: ${event.error.code}`, {
      paymentId: event.paymentId,
      amount: event.amount,
    });

    // Execute all actions in parallel (faster)
    // Each action handles its own errors
    await Promise.allSettled([
      this.refundUser(event),
      this.sendFailureEmail(event),
      this.logAudit(event),
      this.notifyOps(event),
    ]);
  }

  private async refundUser(event: PaymentErrorEvent): Promise<void> {
    try {
      // await this.refundService.processRefund({
      //   paymentId: event.paymentId,
      //   amount: event.amount,
      //   reason: `Payment failed: ${event.error.message}`,
      //   correlationId: event.context.correlationId,
      // });

      this.logger.log(`Refund processed: ${event.paymentId}`);
    } catch (error) {
      // Log but don't fail - other actions should still run
      this.logger.error(`Refund failed for ${event.paymentId}`, { error });
    }
  }

  private async sendFailureEmail(event: PaymentErrorEvent): Promise<void> {
    try {
      // await this.emailService.send({
      //   to: userEmail,
      //   template: 'payment-failed',
      //   data: { amount: event.amount, paymentId: event.paymentId },
      // });

      this.logger.log(`Email sent: ${event.paymentId}`);
    } catch (error) {
      this.logger.error(`Email failed for ${event.paymentId}`, { error });
    }
  }

  private async logAudit(event: PaymentErrorEvent): Promise<void> {
    // Audit logging
  }

  private async notifyOps(event: PaymentErrorEvent): Promise<void> {
    // Alert ops team if payment amount is high
    if (event.amount > 10000) {
      // await this.alertService.send({ severity: 'high', ... });
    }
  }
}
```

---

## Best Practices

### ✅ DO

1. **Make actions idempotent**: Actions may be retried, so ensure they can run multiple times safely
2. **Handle errors gracefully**: Each action should catch and log its own errors
3. **Use Promise.allSettled()**: Run independent actions in parallel
4. **Keep handlers focused**: One handler per concern (payment errors, DB errors, etc.)
5. **Log everything**: Include correlation IDs for traceability
6. **For queued critical actions**: Throw to signal retry if the critical action fails (the queue will back off and retry).

### ❌ DON'T

1. **Don't block the error response**: Actions run async, errors shouldn't affect HTTP response
2. **Don't throw from non-critical handlers**: Catch and log; throwing only makes sense for queued critical actions that need retry.
3. **Don't make handlers dependent**: Actions should be independent (use Promise.allSettled)
4. **Don't put business logic in handlers**: Keep handlers focused on compensation/notification

---

## Adding New Error Types

### Step 1: Create Error Event Class

```typescript
// src/libs/exceptions/error-events.ts

export class MyCustomErrorEvent extends ErrorEvent {
  constructor(
    error: BaseException,
    context: ErrorEventContext,
    public readonly customField: string,
  ) {
    super(error, context, true); // Set true for CRITICAL events (uses Queue)
  }
}
```

### Step 2: Register in ErrorActionService

```typescript
// src/libs/exceptions/error-action.service.ts

onModuleInit() {
  // ... existing registrations
  this.eventBus.subscribe('MyCustomErrorEvent', this.handleErrorEvent.bind(this));
}

private createErrorEvent(error: BaseException, context: any): ErrorEvent | null {
  switch (error.code) {
    // ... existing cases
    case 'MY_CUSTOM_ERROR':
      return new MyCustomErrorEvent(error, errorContext, context.customField);
  }
}
```

### Step 3: Create Handler

```typescript
@Injectable()
export class MyCustomErrorHandler implements ErrorActionHandler {
  canHandle(event: ErrorEvent): boolean {
    return event instanceof MyCustomErrorEvent;
  }

  async handle(event: MyCustomErrorEvent): Promise<void> {
    // Your actions
  }
}
```

### Step 4: Register Handler

```typescript
// In your module's onModuleInit()
this.errorActionService.registerHandler(this.myCustomErrorHandler);
```

---

## Testing Error Actions

### Unit Test Handler

```typescript
describe("PaymentErrorHandler", () => {
  let handler: PaymentErrorHandler;
  let refundService: jest.Mocked<RefundService>;
  let emailService: jest.Mocked<EmailService>;

  beforeEach(() => {
    refundService = { processRefund: jest.fn() } as any;
    emailService = { send: jest.fn() } as any;
    handler = new PaymentErrorHandler(refundService, emailService);
  });

  it("should refund and send email on payment error", async () => {
    const event = new PaymentErrorEvent(
      new PaymentFailedError("Payment failed"),
      { correlationId: "123", timestamp: new Date().toISOString() },
      "payment-123",
      100,
      "account-456",
    );

    await handler.handle(event);

    expect(refundService.processRefund).toHaveBeenCalledWith({
      paymentId: "payment-123",
      amount: 100,
    });
    expect(emailService.send).toHaveBeenCalled();
  });
});
```

### Integration Test

```typescript
it("should trigger handler when payment error occurs", async () => {
  // Make request that causes payment error
  const response = await request(app.getHttpServer())
    .post("/payments")
    .send({ amount: 100 })
    .expect(500);

  // Wait a bit for async handler to run
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Verify refund was processed
  expect(refundService.processRefund).toHaveBeenCalled();
});
```

---

## Error Context Available

All error events include:

```typescript
event.context = {
  correlationId: string;      // Request correlation ID
  userId?: string;            // User ID (if authenticated)
  requestPath?: string;       // HTTP path
  requestMethod?: string;     // HTTP method
  timestamp: string;          // ISO timestamp
}

event.error = BaseException   // The original error with all details
```

---

## Summary

✅ **Automatic**: Errors automatically trigger handlers  
✅ **Async**: Actions don't block error responses  
✅ **Decoupled**: Handlers are independent services  
✅ **Testable**: Easy to unit test handlers  
✅ **Extensible**: Easy to add new error types and handlers  
✅ **Reliable**: Handlers handle their own errors gracefully

---

## Related Files

- **Error Events**: `src/libs/exceptions/error-events.ts`
- **Handler Interface**: `src/libs/exceptions/error-action.handler.ts`
- **Action Service**: `src/libs/exceptions/error-action.service.ts`
- **Global Filter**: `src/libs/exceptions/global-exception.filter.ts`
- **Example Handler**: `src/modules/payments/application/error-handlers/payment-error.handler.ts`
