import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ErrorEvent } from "./error-events";
import { ErrorActionHandler } from "./error-action.handler";
import { ErrorActionStatusService } from "./error-action-status";
import Redis from "ioredis";

/**
 * Queue for critical error actions.
 * Ensures guaranteed execution for critical errors (e.g. refunds).
 *
 * Implements a hybrid queue:
 * 1. Tries to use Redis (persistent)
 * 2. Falls back to In-Memory (if Redis fails)
 */
@Injectable()
export class ErrorActionQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ErrorActionQueue.name);
  private readonly queue: ErrorEvent[] = []; // Fallback in-memory queue
  private isProcessing = false;
  private handlers: ErrorActionHandler[] = [];
  private statusService: ErrorActionStatusService | null = null;

  private redis: Redis | null = null;
  private readonly REDIS_KEY = "error_action_queue";
  private useRedis = false;
  private redisReconnectInterval: NodeJS.Timeout | null = null;
  private readonly REDIS_RECONNECT_INTERVAL = 10000; // 10 seconds

  // Retry configuration
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 1000;

  constructor() {
    // Try to connect to Redis
    try {
      this.redis = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => {
          if (times > 3) {
            this.logger.warn(
              "Redis connection failed, switching to in-memory mode",
            );
            this.useRedis = false;
            return null; // Stop retrying
          }
          return Math.min(times * 50, 2000);
        },
      });

      this.redis.on("connect", () => {
        this.logger.log("Connected to Redis for Error Action Queue");
        this.useRedis = true;
        this.clearRedisReconnectInterval();
        this.processQueue(); // Start processing any existing items
      });

      this.redis.on("error", (err) => {
        this.logger.error("Redis error in Error Action Queue", err);
        this.useRedis = false;
        this.startRedisReconnectLoop();
      });

      this.redis.on("close", () => {
        this.logger.warn(
          "Redis connection closed, switching to in-memory mode",
        );
        this.useRedis = false;
        this.startRedisReconnectLoop();
      });

      this.redis.on("reconnecting", () => {
        this.logger.log("Attempting to reconnect to Redis...");
      });
    } catch (error) {
      this.logger.warn(
        "Failed to initialize Redis client, using in-memory queue",
      );
      this.useRedis = false;
      this.startRedisReconnectLoop();
    }
  }

  onModuleInit() {
    // Start processing loop
    this.processQueue();
  }

  /**
   * Handle application shutdown - cleanup Redis and intervals
   */
  async onModuleDestroy() {
    this.clearRedisReconnectInterval();
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch (error) {
        this.logger.error("Error closing Redis connection", error);
      }
    }
  }

  /**
   * Start attempting to reconnect to Redis
   */
  private startRedisReconnectLoop() {
    if (this.redisReconnectInterval) {
      return; // Already running
    }

    this.redisReconnectInterval = setInterval(() => {
      if (!this.useRedis && this.redis) {
        this.logger.log(
          "Attempting to reconnect to Redis for Error Action Queue...",
        );
        this.redis
          ?.ping()
          .then(() => {
            this.logger.log("Redis reconnected successfully!");
            this.useRedis = true;
            this.clearRedisReconnectInterval();
            this.processQueue(); // Resume processing
          })
          .catch((err) => {
            this.logger.debug("Redis reconnection attempt failed", err.message);
          });
      }
    }, this.REDIS_RECONNECT_INTERVAL);
  }

  /**
   * Clear the reconnection interval
   */
  private clearRedisReconnectInterval() {
    if (this.redisReconnectInterval) {
      clearInterval(this.redisReconnectInterval);
      this.redisReconnectInterval = null;
    }
  }

  /**
   * Register handlers to process queued events
   */
  registerHandler(handler: ErrorActionHandler) {
    this.handlers.push(handler);
  }

  /**
   * Set status service for tracking (called by ErrorActionService)
   */
  setStatusService(statusService: ErrorActionStatusService) {
    this.statusService = statusService;
  }

  /**
   * Add a critical event to the queue
   */
  async add(event: ErrorEvent): Promise<void> {
    if (this.useRedis && this.redis) {
      try {
        // Serialize event with type info so we can reconstruct it
        const payload = JSON.stringify({
          type: event.constructor.name,
          data: event,
        });
        await this.redis.rpush(this.REDIS_KEY, payload);
        this.logger.log(
          `Added critical event to Redis queue: ${event.constructor.name}`,
        );
      } catch (error) {
        this.logger.error(
          "Failed to add to Redis queue, falling back to in-memory",
          error,
        );
        this.useRedis = false;
        this.addToInMemory(event);
      }
    } else {
      this.addToInMemory(event);
    }

    // Trigger processing if idle
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  private addToInMemory(event: ErrorEvent) {
    this.queue.push(event);
    this.logger.log(
      `Added critical event to in-memory queue: ${event.constructor.name}. Queue size: ${this.queue.length}`,
    );
  }

  /**
   * Process the queue
   */
  private async processQueue() {
    if (this.isProcessing) return;

    this.isProcessing = true;

    try {
      while (true) {
        let event: ErrorEvent | null = null;

        // 1. Try to get from Redis first
        if (this.useRedis && this.redis) {
          try {
            const payload = await this.redis.lpop(this.REDIS_KEY);
            if (payload) {
              const parsed = JSON.parse(payload);
              event = this.reconstructEvent(parsed);
            }
          } catch (error) {
            this.logger.error("Error reading from Redis queue", error);
            this.useRedis = false; // Switch to in-memory on read error
          }
        }

        // 2. If no Redis item, check in-memory queue
        if (!event && this.queue.length > 0) {
          event = this.queue.shift() || null;
        }

        // 3. If nothing in either queue, stop
        if (!event) break;

        try {
          await this.processEventWithRetry(event);
        } catch (error) {
          this.logger.error(
            `Failed to process critical event after retries: ${event.constructor.name}`,
            error,
          );
          // In a real system, we would move this to a Dead Letter Queue (DLQ)
          // For now, maybe push back to Redis DLQ?
        }
      }
    } finally {
      this.isProcessing = false;

      // Check if more items were added while processing (double check)
      if ((this.useRedis && this.redis) || this.queue.length > 0) {
        // Use setTimeout to avoid stack overflow and allow event loop to breathe
        setTimeout(() => this.processQueue(), 100);
      }
    }
  }

  /**
   * Reconstruct event object from JSON data
   * This is needed because JSON.stringify/parse loses the class prototype
   */
  private reconstructEvent(parsed: any): ErrorEvent {
    // We need to map the type name back to the actual class
    // This is a simplified version. In a real app, you might use a factory or class-transformer
    const {
      PaymentErrorEvent,
      DatabaseConnectionErrorEvent,
      ExternalServiceErrorEvent,
      ConcurrencyErrorEvent,
    } = require("./error-events");

    const data = parsed.data;
    let event: any;

    switch (parsed.type) {
      case "PaymentErrorEvent":
        event = new PaymentErrorEvent(
          data.error,
          data.context,
          data.paymentId,
          data.amount,
          data.accountId,
        );
        break;
      case "DatabaseConnectionErrorEvent":
        event = new DatabaseConnectionErrorEvent(
          data.error,
          data.context,
          data.database,
        );
        break;
      // Add other types...
      default:
        // Fallback for unknown types, just attach data
        event = data;
        event.constructor = { name: parsed.type }; // Fake constructor name for logging
    }

    // Restore isCritical flag if it was lost (though it should be in data)
    if (data.isCritical !== undefined) event.isCritical = data.isCritical;

    return event;
  }

  /**
   * Process a single event with retry logic
   */
  private async processEventWithRetry(
    event: ErrorEvent,
    attempt = 1,
    actionId?: string,
  ): Promise<void> {
    const applicableHandlers = this.handlers.filter((h) => h.canHandle(event));

    if (applicableHandlers.length === 0) {
      this.logger.warn(
        `No handlers found for queued event: ${event.constructor.name}`,
      );
      return;
    }

    try {
      // Track status for critical actions
      if (!actionId) {
        actionId = this.statusService?.markPending(
          event,
          `Queue[${applicableHandlers[0]?.constructor.name}]`,
          true,
        );
      }

      if (actionId) {
        this.statusService?.markRunning(actionId);
      }

      // Execute handlers sequentially for safety
      for (const handler of applicableHandlers) {
        await handler.handle(event);
      }

      if (actionId) {
        this.statusService?.markSuccess(actionId);
      }

      this.logger.log(
        `Successfully processed critical event: ${event.constructor.name}`,
      );
    } catch (error) {
      if (attempt < this.MAX_RETRIES) {
        this.logger.warn(
          `Retry attempt ${attempt} for ${event.constructor.name}`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, this.RETRY_DELAY_MS * attempt),
        );
        return this.processEventWithRetry(event, attempt + 1, actionId);
      }

      if (actionId) {
        this.statusService?.markFailed(actionId, error as Error);
      }

      throw error;
    }
  }
}
