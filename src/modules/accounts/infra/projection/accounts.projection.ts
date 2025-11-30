import { Injectable } from '@nestjs/common';
import { Db } from 'mongodb';
import { CircuitBreaker } from '../../../../libs/resilience/circuit-breaker';
import { AccountOpenedEvent } from '../../domain/events/account-opened.event';
import { DepositedEvent } from '../../domain/events/deposited.event';
import { WithdrawnEvent } from '../../domain/events/withdrawn.event';

@Injectable()
export class AccountsProjection {
  private circuitBreaker: CircuitBreaker;

  constructor(private readonly db: Db) {
    // Initialize circuit breaker for projection operations
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 10000,
      name: 'AccountsProjection',
    });
  }

  async project(event: any) {
    return this.circuitBreaker.execute(async () => {
      const coll = this.db.collection('accounts_read');

      if (event instanceof AccountOpenedEvent) {
        await coll.updateOne(
          { accountId: event.accountId },
          { 
            $set: { 
              accountId: event.accountId, 
              ownerId: event.ownerId, 
              currency: event.currency 
            }, 
            $setOnInsert: { balance: 0 } 
          },
          { upsert: true }
        );
        if (event.balance > 0) {
          await coll.updateOne({ accountId: event.accountId }, { $inc: { balance: event.balance } });
        }
        return;
      }

      if (event instanceof DepositedEvent) {
        await coll.updateOne({ accountId: event.accountId }, { $inc: { balance: event.amount } });
        return;
      }

      /**
       * Handle withdrawal event
       * INCOMPLETE - TO BE IMPLEMENTED BY INTERVIEWEE
       */
      if (event instanceof WithdrawnEvent) {
        // TODO: Implement withdrawal projection
        throw new Error('Method not implemented');
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
