import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ErrorTrackingService } from "./error-tracking.service";
import { ErrorMetricsService } from "./error-metrics.service";
import { ErrorActionService } from "../exceptions/error-action.service";
import { EventBus } from "../cqrs/event-bus";
import { ErrorActionQueue } from "../exceptions/error-action.queue";
import { ErrorActionStatusService } from "../exceptions/error-action-status";

export const REDIS_ERROR_ACTION = "REDIS_ERROR_ACTION";

@Module({
  providers: [
    // Redis connection for error action tracking (optional - falls back to in-memory)
    {
      provide: REDIS_ERROR_ACTION,
      useFactory: async (configService: ConfigService) => {
        try {
          // Use require() instead of import() for optional dependency
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const Redis = require("ioredis").default || require("ioredis");
          const redis = new Redis({
            host: configService.get<string>("REDIS_HOST", "localhost"),
            port: parseInt(configService.get<string>("REDIS_PORT", "6379")),
            retryStrategy: (times: number) => {
              const delay = Math.min(times * 50, 2000);
              return delay;
            },
            maxRetriesPerRequest: 3,
            db: 1, // Use different DB from other services
          });

          // Test connection
          await redis.ping();
          console.log("[Redis:ErrorAction] Connected successfully");
          return redis;
        } catch (error: any) {
          console.warn(
            "[Redis:ErrorAction] Not available, will use in-memory store:",
            error?.message || String(error),
          );
          return null;
        }
      },
      inject: [ConfigService],
    },

    // Error action status service with Redis support
    {
      provide: ErrorActionStatusService,
      useFactory: (redis: any) => {
        if (redis) {
          console.log(
            "[ErrorActionStatusService] Using Redis (persistent tracking)",
          );
          return new ErrorActionStatusService(redis);
        } else {
          console.warn(
            "[ErrorActionStatusService] Using in-memory (development mode)",
          );
          return new ErrorActionStatusService();
        }
      },
      inject: [REDIS_ERROR_ACTION],
    },

    ErrorTrackingService,
    ErrorMetricsService,
    EventBus, // Required by ErrorActionService
    ErrorActionService,
    ErrorActionQueue,
  ],
  exports: [
    ErrorTrackingService,
    ErrorMetricsService,
    ErrorActionService, // Export so handlers can register themselves
    ErrorActionStatusService, // Export for admin endpoints
    EventBus, // Export so modules can use it
    ErrorActionQueue,
  ],
})
export class MonitoringModule {}
