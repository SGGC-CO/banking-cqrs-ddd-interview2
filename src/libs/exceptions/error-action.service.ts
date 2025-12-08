import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { EventBus } from "../cqrs/event-bus";
import { ErrorActionHandler } from "./error-action.handler";
import { ErrorEvent } from "./error-events";
import { BaseException } from "./base.exception";
import { ErrorActionQueue } from "./error-action.queue";
import { ErrorActionStatusService } from "./error-action-status";

/**
 * Service that publishes error events and routes them to registered handlers.
 *
 * Usage:
 * 1. Register handlers via OnModuleInit in your module
 * 2. Call publishError() when an error occurs (typically from GlobalExceptionFilter)
 * 3. Handlers automatically receive errors they can handle
 */
@Injectable()
export class ErrorActionService implements OnModuleInit {
  private readonly logger = new Logger(ErrorActionService.name);
  private readonly handlers: ErrorActionHandler[] = [];

  constructor(
    private readonly eventBus: EventBus,
    private readonly errorActionQueue: ErrorActionQueue,
    private readonly statusService: ErrorActionStatusService,
  ) {}

  onModuleInit() {
    // Register all error event types with the event bus
    this.eventBus.subscribe(
      "PaymentErrorEvent",
      this.handleErrorEvent.bind(this),
    );
    this.eventBus.subscribe(
      "DatabaseConnectionErrorEvent",
      this.handleErrorEvent.bind(this),
    );
    this.eventBus.subscribe(
      "ExternalServiceErrorEvent",
      this.handleErrorEvent.bind(this),
    );
    this.eventBus.subscribe(
      "ConcurrencyErrorEvent",
      this.handleErrorEvent.bind(this),
    );
    // Add more error event types as needed
  }

  /**
   * Register an error action handler
   */
  registerHandler(handler: ErrorActionHandler): void {
    this.handlers.push(handler);
    // Also register with the queue so it can process critical events
    this.errorActionQueue.registerHandler(handler);
    this.logger.log(
      `Registered error action handler: ${handler.constructor.name}`,
    );
  }

  /**
   * Get error action statistics (for monitoring/admin endpoints)
   */
  getStatistics() {
    return this.statusService.getStatistics();
  }

  /**
   * Get critical actions pending/running (for health checks)
   */
  getCriticalPending() {
    return this.statusService.getCriticalPending();
  }

  /**
   * Get recent failures (for debugging/alerts)
   */
  getCriticalFailures() {
    return this.statusService.getCriticalFailures();
  }

  /**
   * Publish an error event (typically called from GlobalExceptionFilter)
   */
  async publishError(error: BaseException, context: any): Promise<void> {
    try {
      // Create appropriate error event based on error type
      const errorEvent = this.createErrorEvent(error, context);

      if (errorEvent) {
        // Publish to event bus - handlers will be called automatically
        await this.eventBus.publish(errorEvent);
      }
    } catch (err) {
      // Don't let error handling break the main error flow
      this.logger.error("Failed to publish error event", {
        error: err,
        originalError: error.code,
      });
    }
  }

  /**
   * Handle error events from the event bus
   * Routes to appropriate handlers based on canHandle()
   */
  private async handleErrorEvent(event: ErrorEvent): Promise<void> {
    const applicableHandlers = this.handlers.filter((h) => h.canHandle(event));

    if (applicableHandlers.length === 0) {
      this.logger.debug(
        `No handlers found for error event: ${event.constructor.name}`,
      );
      return;
    }

    // Hybrid approach:
    // 1. Critical events -> Queue (Guaranteed execution)
    // 2. Non-critical events -> Fire-and-forget (Fast)

    if (event.isCritical) {
      this.logger.log(
        `Queueing critical error action: ${event.constructor.name}`,
      );
      await this.errorActionQueue.add(event);
      return;
    }

    // Execute all applicable handlers in parallel (Fire-and-forget)
    const handlerPromises = applicableHandlers.map(async (handler) => {
      // Track action status
      const actionId = this.statusService.markPending(
        event,
        handler.constructor.name,
        event.isCritical,
      );

      try {
        this.statusService.markRunning(actionId);
        await handler.handle(event);
        this.statusService.markSuccess(actionId);
        this.logger.debug(
          `Handler ${handler.constructor.name} successfully processed ${event.constructor.name}`,
        );
      } catch (err) {
        // Track failure but don't fail the whole flow
        this.statusService.markFailed(actionId, err as Error);
        this.logger.error(
          `Error in handler ${handler.constructor.name} for ${event.constructor.name}`,
          {
            handlerError: err,
            originalError: event.error.code,
          },
        );
      }
    });

    await Promise.allSettled(handlerPromises);
  }

  /**
   * Create appropriate error event from BaseException
   */
  private createErrorEvent(
    error: BaseException,
    context: any,
  ): ErrorEvent | null {
    const errorContext = {
      correlationId: context.correlationId,
      userId: context.userId,
      requestPath: context.path,
      requestMethod: context.method,
      timestamp: new Date().toISOString(),
    };

    // Import error events (lazy import to avoid circular dependencies if needed)
    const {
      PaymentErrorEvent,
      DatabaseConnectionErrorEvent,
      ExternalServiceErrorEvent,
      ConcurrencyErrorEvent,
    } = require("./error-events");

    // Map error types to events
    switch (error.code) {
      case "PAYMENT_FAILED":
      case "PAYMENT_GATEWAY_ERROR":
        return new PaymentErrorEvent(
          error,
          errorContext,
          context.paymentId || "unknown",
          context.amount || 0,
          context.accountId,
        );

      case "DATABASE_CONNECTION_ERROR":
        return new DatabaseConnectionErrorEvent(
          error,
          errorContext,
          context.database || error.details?.database || "unknown",
        );

      case "EXTERNAL_SERVICE_ERROR":
      case "EXTERNAL_SERVICE_TIMEOUT":
        return new ExternalServiceErrorEvent(
          error,
          errorContext,
          context.serviceName || error.details?.serviceName || "unknown",
          context.operation || "unknown",
        );

      case "CONCURRENCY_CONFLICT":
        return new ConcurrencyErrorEvent(
          error,
          errorContext,
          context.aggregateId || error.details?.aggregateId || "unknown",
          context.expectedVersion || error.details?.expectedVersion || 0,
        );

      default:
        // No event for this error type
        return null;
    }
  }
}
