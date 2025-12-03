import { Module } from '@nestjs/common';
import { ConfigService } from "@nestjs/config";
import { CommandBus } from "../../libs/cqrs/command-bus";
import { EventBus } from "../../libs/cqrs/event-bus";
import { QueryBus } from "../../libs/cqrs/query-bus";
import {
  InMemoryIdempotencyStore,
  RedisIdempotencyStore,
} from "../../libs/resilience/idempotency-redis";
import { DatabaseModule } from "../database/database.module";
import { DepositHandler } from "./application/handlers/deposit.handler";
import { GetAccountHandler } from "./application/handlers/get-account.handler";
import { OpenAccountHandler } from "./application/handlers/open-account.handler";
import { WithdrawHandler } from "./application/handlers/withdraw.handler";
import { AccountEventRepository } from "./domain/repositories/account-event.repository";
import { AccountsController } from "./http/accounts.controller";
import { BusWiringService } from "./infra/bus-wiring.service";
import { MongoEventStore } from "./infra/event-store/event-store";
import { AccountsProjection } from "./infra/projection/accounts.projection";

// Redis configuration constants
export const REDIS = "REDIS_CONNECTION";
export const IDEMPOTENCY_STORE = "IDEMPOTENCY_STORE";

@Module({
  imports: [DatabaseModule],
  controllers: [AccountsController],
  providers: [
    // CQRS Buses - simple @Injectable classes
    CommandBus,
    QueryBus,
    EventBus,

    // Redis connection (optional - falls back to in-memory)
    {
      provide: REDIS,
      useFactory: async (configService: ConfigService) => {
        try {
          // Use require() instead of import() for optional dependency
          // TypeScript won't check require() at compile time
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
          });

          // Test connection
          await redis.ping();
          console.log("[Redis] Connected successfully");
          return redis;
        } catch (error: any) {
          console.warn(
            "[Redis] Not available, will use in-memory store:",
            error?.message || String(error),
          );
          return null;
        }
      },
      inject: [ConfigService],
    },

    // Idempotency store - Redis if available, otherwise in-memory
    // useFactory is appropriate here: conditional logic based on Redis availability
    {
      provide: IDEMPOTENCY_STORE,
      useFactory: (redis: any) => {
        if (redis) {
          console.log("[IdempotencyStore] Using Redis (production mode)");
          return new RedisIdempotencyStore(redis);
        } else {
          console.warn(
            "[IdempotencyStore] Using in-memory (development mode - NOT for production!)",
          );
          return new InMemoryIdempotencyStore();
        }
      },
      inject: [REDIS],
    },

    // Infrastructure - now using @Injectable, NestJS handles instantiation
    MongoEventStore,
    AccountsProjection,
    AccountEventRepository,

    // Command Handlers - NestJS injects dependencies automatically
    OpenAccountHandler,
    DepositHandler,
    WithdrawHandler,

    // Query Handlers
    GetAccountHandler,

    // Bus wiring service - automatically wires handlers on module init
    BusWiringService,
  ],
  exports: [MongoEventStore, AccountsProjection], // Export for use in AdminModule
})
export class AccountsModule {}
