import { Injectable } from '@nestjs/common';
import { Collection, Db } from 'mongodb';
import { CircuitBreaker } from '../../../../libs/resilience/circuit-breaker';

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

  constructor(private db: Db) {
    this.events = db.collection<StoredEvent>('events');
    
    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5, // Open circuit after 5 consecutive failures
      successThreshold: 2, // Close circuit after 2 consecutive successes
      timeout: 10000, // Wait 10 seconds before attempting recovery
      name: 'MongoEventStore',
    });
    
    // Create indexes
    this.events.createIndex({ aggregateId: 1, version: 1 }, { unique: true }).catch(() => {});
    this.events.createIndex({ aggregateId: 1, timestamp: 1 }).catch(() => {});
  }

  /**
   * Append events to the event store
   */
  async append(aggregateId: string, aggregateType: string, expectedVersion: number, newEvents: any[]) {
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
      } catch (e: any) {
        if (e?.message?.includes('E11000')) {
          throw new Error('ConcurrencyError: aggregate version conflict');
        }
        throw e;
      }
    });
  }

  /**
   * Load events for an aggregate
   */
  async load(aggregateId: string) {
    return this.circuitBreaker.execute(async () => {
      const cur = this.events.find({ aggregateId }).sort({ version: 1 });
      return cur.toArray();
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
