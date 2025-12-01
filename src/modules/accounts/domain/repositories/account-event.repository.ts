import { Injectable } from '@nestjs/common';
import { EventBus } from "../../../../libs/cqrs/event-bus";
import { CircuitBreakerError } from "../../../../libs/resilience/circuit-breaker";
import { MongoEventStore } from "../../infra/event-store/event-store";
import { Account } from "../aggregates/account.aggregate";

@Injectable()
export class AccountEventRepository {
  constructor(
    private readonly store: MongoEventStore,
    private readonly bus?: EventBus,
  ) {}

  async getById(id: string): Promise<Account | null> {
    try {
      const events = await this.store.load(id);
      if (!events.length) return null;
      return Account.rehydrate(events);
    } catch (error) {
      if (error instanceof CircuitBreakerError) {
        console.error(
          `[AccountEventRepository] Cannot load account ${id}: Circuit breaker is OPEN`,
        );
        throw error; // Re-throw to be handled by global filter
      }
      throw error;
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
      if (error instanceof CircuitBreakerError) {
        console.error(
          `[AccountEventRepository] Cannot save account ${aggregate.id}: Circuit breaker is OPEN`,
        );
        console.error(
          `[AccountEventRepository] ${events.length} uncommitted event(s) not persisted`,
        );

        // Restore events back to aggregate using proper method
        // This allows retry logic to attempt save again without data loss
        aggregate.restoreUncommittedEvents(events);

        throw error; // Re-throw to be handled by global filter
      }
      throw error;
    }
  }
}
