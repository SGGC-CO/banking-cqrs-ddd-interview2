import { Controller, Get, Post, Res } from "@nestjs/common";
import { Response } from "express";
import { MongoEventStore } from "../accounts/infra/event-store/event-store";
import { AccountsProjection } from "../accounts/infra/projection/accounts.projection";
import { ErrorMetricsService } from "../../libs/monitoring/error-metrics.service";

@Controller("admin")
export class AdminController {
  constructor(
    private readonly eventStore: MongoEventStore,
    private readonly projection: AccountsProjection,
    private readonly errorMetrics: ErrorMetricsService,
  ) {}

  @Get("health")
  healthCheck() {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "banking-cqrs-ddd",
      data: null,
    };
  }

  /**
   * Get circuit breaker status for monitoring
   */
  @Get("circuit-breaker/status")
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
  @Post("circuit-breaker/reset")
  resetCircuitBreakers() {
    this.eventStore.resetCircuitBreaker();
    this.projection.resetCircuitBreaker();
    return {
      message: "Circuit breakers reset successfully",
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Prometheus metrics endpoint
   * Returns Prometheus-formatted metrics if prom-client is available
   */
  @Get("metrics")
  async getMetrics(@Res() res: Response) {
    const metrics = await this.errorMetrics.getMetrics();

    if (metrics) {
      res.set("Content-Type", "text/plain");
      res.send(metrics);
    } else {
      res.status(503).json({
        message: "Metrics not available - Prometheus client not configured",
      });
    }
  }

  /**
   * INCOMPLETE - TO BE IMPLEMENTED BY INTERVIEWEE
   *
   * Suggested implementation:
   * - Add an endpoint to view all events in the system
   * - Add an endpoint to replay events and rebuild projections
   */
}
