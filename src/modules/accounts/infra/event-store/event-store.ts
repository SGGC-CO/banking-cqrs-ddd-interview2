import { Injectable, Inject } from "@nestjs/common";
import { Collection, Db } from "mongodb";
import { CircuitBreaker } from "../../../../libs/resilience/circuit-breaker";
import { normalizeMongoError } from "../../../../libs/exceptions/maps/mongo-error.util";
import { ConcurrencyError } from "../../../../libs/exceptions/domain.exceptions";
import { DB } from "../../../database/database.module";

export interface StoredEvent {
  _id?: any;
  aggregateId: string;
  aggregateType: string;
  version: number;
  type: string;
  payload: any;
  timestamp: string;
}

@Injectable()
export class MongoEventStore {
  private events: Collection<StoredEvent>;
  private circuitBreaker: CircuitBreaker;

  constructor(@Inject(DB) private db: Db) {
    this.events = db.collection<StoredEvent>("events");

    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5, // Open circuit after 5 consecutive failures
      successThreshold: 2, // Close circuit after 2 consecutive successes
      timeout: 10000, // Wait 10 seconds before attempting recovery
      name: "MongoEventStore",
    });

    // Create indexes
    this.events
      .createIndex({ aggregateId: 1, version: 1 }, { unique: true })
      .catch(() => {});
    this.events.createIndex({ aggregateId: 1, timestamp: 1 }).catch(() => {});
  }

  /**
   * Append events to the event store
   */
  async append(
    aggregateId: string,
    aggregateType: string,
    expectedVersion: number,
    newEvents: any[],
  ) {
    return this.circuitBreaker.execute(async () => {
      const docs: StoredEvent[] = newEvents.map((ev, i) => ({
        aggregateId,
        aggregateType,
        version: expectedVersion + i + 1,
        type: ev.constructor.name,
        payload: ev,
        timestamp: new Date().toISOString(),
      }));

      try {
        if (docs.length) await this.events.insertMany(docs, { ordered: true });
      } catch (error) {
        const message = (error as Error)?.message || "";

        // Handle optimistic concurrency violations (MongoDB duplicate key error)
        if (message.includes("E11000")) {
          // The version that failed is the first version we attempted to save
          // expectedVersion is the version before the new events, so first attempted version is expectedVersion + 1
          const attemptedVersion = expectedVersion + 1;
          throw new ConcurrencyError(aggregateId, attemptedVersion);
        }

        // Normalize all other Mongo/circuit-breaker errors into our exception hierarchy
        normalizeMongoError(error, "append", "events");
      }
    });
  }

  /**
   * Load events for an aggregate
   */
  async load(aggregateId: string) {
    return this.circuitBreaker.execute(async () => {
      try {
        const cur = this.events.find({ aggregateId }).sort({ version: 1 });
        return await cur.toArray();
      } catch (error) {
        normalizeMongoError(error, "load", "events");
      }
    });
  }

  /**
   * Get circuit breaker metrics for monitoring
   */
  getCircuitBreakerMetrics() {
    return this.circuitBreaker.getMetrics();
  }

  /**
   * Manually reset circuit breaker (for admin/recovery operations)
   */
  resetCircuitBreaker() {
    this.circuitBreaker.reset();
  }
}
