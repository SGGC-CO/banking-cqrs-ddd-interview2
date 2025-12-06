import { Injectable } from '@nestjs/common';
import { EventBus } from "../../../../libs/cqrs/event-bus";
import { AccountNotFoundError } from "../../../../libs/exceptions/domain.exceptions";
import { MongoEventStore } from "../../infra/event-store/event-store";
import { Account } from "../aggregates/account.aggregate";

@Injectable()
export class AccountEventRepository {
  constructor(
    private readonly store: MongoEventStore,
    private readonly bus?: EventBus,
  ) {}

  async getById(id: string): Promise<Account> {
    const events = await this.store.load(id);
    if (!events.length) {
      throw new AccountNotFoundError(id);
    }
    return Account.rehydrate(events);
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
      // Always restore uncommitted events on failure
      aggregate.restoreUncommittedEvents(events);

      // Let classified exceptions bubble up (ConcurrencyError, CircuitBreakerError, Database*Error, etc.)
      throw error;
    }
  }
}
