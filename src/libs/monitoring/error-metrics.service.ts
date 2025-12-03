import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ErrorMetricsService {
  private readonly logger = new Logger(ErrorMetricsService.name);
  private metricsAvailable = false;
  private errorCounter: any;
  private errorLatency: any;

  constructor() {
    // Check if prom-client is available (optional dependency)
    try {
      const promClient = require('prom-client');
      const register = new promClient.Registry();

      this.errorCounter = new promClient.Counter({
        name: 'http_errors_total',
        help: 'Total number of HTTP errors',
        labelNames: ['method', 'path', 'status_code', 'error_code'],
        registers: [register],
      });

      this.errorLatency = new promClient.Histogram({
        name: 'error_response_duration_seconds',
        help: 'Error response duration in seconds',
        labelNames: ['error_code'],
        buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
        registers: [register],
      });

      // Store register for metrics endpoint
      (this as any).register = register;
      this.metricsAvailable = true;
      this.logger.log('Prometheus metrics initialized');
    } catch (error) {
      this.logger.warn('Prometheus not available - metrics will be logged only');
    }
  }

  recordError(
    method: string,
    path: string,
    statusCode: number,
    errorCode: string,
    duration: number
  ) {
    const normalizedPath = this.normalizePath(path);

    if (this.metricsAvailable) {
      try {
        this.errorCounter.inc({
          method,
          path: normalizedPath,
          status_code: statusCode.toString(),
          error_code: errorCode,
        });

        this.errorLatency.observe({ error_code: errorCode }, duration / 1000);
      } catch (error) {
        this.logger.warn('Failed to record error metric');
      }
    } else {
      // Fallback: Log metrics
      this.logger.debug({
        metric: 'error',
        method,
        path: normalizedPath,
        statusCode,
        errorCode,
        durationMs: duration,
      });
    }
  }

  private normalizePath(path: string): string {
    // Replace IDs with placeholders for better grouping
    return path
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
      .replace(/\/\d+/g, '/:id');
  }

  /**
   * Get Prometheus metrics (if available)
   * Used by metrics endpoint
   */
  async getMetrics(): Promise<string | null> {
    if (this.metricsAvailable && (this as any).register) {
      try {
        const register = (this as any).register;
        return register.metrics();
      } catch (error) {
        this.logger.warn('Failed to get metrics');
        return null;
      }
    }
    return null;
  }
}

