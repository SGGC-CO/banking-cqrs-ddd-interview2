import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { CircuitBreakerError } from './circuit-breaker';

/**
 * Global exception filter to handle circuit breaker errors
 * Returns 503 Service Unavailable with retry-after header
 */
@Catch(CircuitBreakerError)
export class CircuitBreakerExceptionFilter implements ExceptionFilter {
  catch(exception: CircuitBreakerError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    const status = HttpStatus.SERVICE_UNAVAILABLE; // 503

    response
      .status(status)
      .header('Retry-After', '10') // Suggest retry after 10 seconds
      .json({
        statusCode: status,
        timestamp: new Date().toISOString(),
        path: request.url,
        message: 'Service temporarily unavailable due to database issues',
        error: 'Service Unavailable',
        details: exception.message,
        retryAfter: 10,
      });
  }
}
