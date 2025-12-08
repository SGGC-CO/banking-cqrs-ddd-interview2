import { Injectable, Logger } from "@nestjs/common";
import { ErrorActionHandler } from "../../../libs/exceptions/error-action.handler";
import {
  DatabaseConnectionErrorEvent,
  ErrorEvent,
} from "../../../libs/exceptions/error-events";

/**
 * Handler for database connection errors.
 * This is a critical infrastructure handler that notifies operations teams.
 */
@Injectable()
export class DatabaseConnectionErrorHandler implements ErrorActionHandler {
  private readonly logger = new Logger(DatabaseConnectionErrorHandler.name);

  canHandle(event: ErrorEvent): boolean {
    return event instanceof DatabaseConnectionErrorEvent;
  }

  async handle(event: DatabaseConnectionErrorEvent): Promise<void> {
    this.logger.error(`Database connection error detected: ${event.database}`, {
      database: event.database,
      correlationId: event.context.correlationId,
    });

    // Critical Action: Notify Ops Team immediately
    // Since this is a critical event, it's processed by the queue with retries

    try {
      // Simulate alerting service call
      this.logger.warn(
        `[ALERT] Sending high-priority alert to Ops Team for DB: ${event.database}`,
      );

      // In a real app, you would inject an AlertService and call it:
      // await this.alertService.triggerPagerDuty({
      //   summary: `Database Connection Failed: ${event.database}`,
      //   severity: 'critical',
      //   source: 'banking-app',
      //   details: { error: event.error.message }
      // });
    } catch (error) {
      this.logger.error("Failed to send alert", error);
      throw error; // Throwing ensures the queue retries this action
    }
  }
}
