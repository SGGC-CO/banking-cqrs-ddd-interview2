import { Injectable } from '@nestjs/common';
import { EventBus } from "../../../../libs/cqrs/event-bus";
import { CircuitBreakerError } from "../../../../libs/resilience/circuit-breaker";
import {
  DatabaseQueryError,
  DatabaseConnectionError,
} from "../../../../libs/exceptions/infrastructure.exceptions";
import {
  AccountNotFoundError,
  ConcurrencyError,
} from "../../../../libs/exceptions/domain.exceptions";
import { MongoEventStore } from "../../infra/event-store/event-store";
import { Account } from "../aggregates/account.aggregate";

@Injectable()
export class AccountEventRepository {
  constructor(
    private readonly store: MongoEventStore,
    private readonly bus?: EventBus,
  ) {}

  async getById(id: string): Promise<Account> {
    try {
      const events = await this.store.load(id);
      if (!events.length) {
        throw new AccountNotFoundError(id);
      }
      return Account.rehydrate(events);
    } catch (error) {
      // Re-throw domain exceptions
      if (error instanceof AccountNotFoundError) {
        throw error;
      }

      // Re-throw circuit breaker errors
      if (error instanceof CircuitBreakerError) {
        throw error;
      }

      // Check if it's a connection error
      const errorMessage = (error as Error).message || "";
      const isConnectionError =
        errorMessage.includes("ECONNREFUSED") ||
        errorMessage.includes("ENOTFOUND") ||
        errorMessage.includes("connect") ||
        errorMessage.includes("MongoServerSelectionError");

      if (isConnectionError) {
        throw new DatabaseConnectionError("MongoDB", error as Error);
      }

      // Other database errors (query syntax, constraints, etc.)
      throw new DatabaseQueryError("load", "events", error as Error);
    }
  }

  async save(aggregate: Account) {
    const events = aggregate.pullUncommittedEvents();

    try {
      await this.store.append(
        aggregate.id!,
        "Account",
        aggregate.version - events.length,
        events,
      );

      // Publish events only after successful persistence
      if (this.bus && events.length) {
        for (const ev of events) await this.bus.publish(ev);
      }
    } catch (error) {
      // Handle concurrency error (MongoDB duplicate key error)
      if ((error as Error).message?.includes("E11000")) {
        aggregate.restoreUncommittedEvents(events);
        throw new ConcurrencyError(aggregate.id!, aggregate.version);
      }

      // Handle circuit breaker
      if (error instanceof CircuitBreakerError) {
        aggregate.restoreUncommittedEvents(events);
        throw error;
      }

      // Check if it's a connection error
      const errorMessage = (error as Error).message || "";
      const isConnectionError =
        errorMessage.includes("ECONNREFUSED") ||
        errorMessage.includes("ENOTFOUND") ||
        errorMessage.includes("connect") ||
        errorMessage.includes("MongoServerSelectionError");

      if (isConnectionError) {
        aggregate.restoreUncommittedEvents(events);
        throw new DatabaseConnectionError("MongoDB", error as Error);
      }

      // Other database errors (query syntax, constraints, etc.)
      throw new DatabaseQueryError("append", "events", error as Error);
    }
  }
}
