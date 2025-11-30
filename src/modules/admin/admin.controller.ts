import { Controller, Get, Post } from '@nestjs/common';
import { MongoEventStore } from '../accounts/infra/event-store/event-store';
import { AccountsProjection } from '../accounts/infra/projection/accounts.projection';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly eventStore: MongoEventStore,
    private readonly projection: AccountsProjection,
  ) {}

  @Get('health')
  healthCheck() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'banking-cqrs-ddd',
      data: null,
    };
  }

  /**
   * Get circuit breaker status for monitoring
   */
  @Get('circuit-breaker/status')
  getCircuitBreakerStatus() {
    return {
      eventStore: this.eventStore.getCircuitBreakerMetrics(),
      projection: this.projection.getCircuitBreakerMetrics(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Reset circuit breakers manually (emergency recovery)
   */
  @Post('circuit-breaker/reset')
  resetCircuitBreakers() {
    this.eventStore.resetCircuitBreaker();
    this.projection.resetCircuitBreaker();
    return {
      message: 'Circuit breakers reset successfully',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * INCOMPLETE - TO BE IMPLEMENTED BY INTERVIEWEE
   * 
   * Suggested implementation:
   * - Add an endpoint to view all events in the system
   * - Add an endpoint to replay events and rebuild projections
   */
}
