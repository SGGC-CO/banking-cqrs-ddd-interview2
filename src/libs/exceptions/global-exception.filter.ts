import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { BaseException } from './base.exception';
import { CircuitBreakerOpenError } from './infrastructure.exceptions';
import { ErrorTrackingService } from '../monitoring/error-tracking.service';
import { ErrorMetricsService } from '../monitoring/error-metrics.service';
import { getCorrelationId } from '../correlation/correlation.middleware';
import { ErrorActionService } from "./error-action.service";

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("ExceptionFilter");

  constructor(
    private readonly errorTracking: ErrorTrackingService,
    private readonly errorMetrics: ErrorMetricsService,
    private readonly errorActionService: ErrorActionService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Get correlation ID from middleware (if available) or generate one
    const correlationId =
      (request as any).correlationId ||
      getCorrelationId() ||
      (request.headers["x-correlation-id"] as string) ||
      this.generateCorrelationId();

    const startTime = (request as any).startTime || Date.now();
    const errorResponse = this.handleException(
      exception,
      correlationId,
      request,
    );

    // Track non-operational errors in Sentry
    if (exception instanceof Error) {
      const shouldTrack =
        !(exception instanceof BaseException) || !exception.isOperational;

      if (shouldTrack) {
        this.errorTracking.captureException(exception, {
          path: request.url,
          method: request.method,
          statusCode: errorResponse.statusCode,
        });
      }
    }

    // Record metrics
    this.errorMetrics.recordError(
      request.method,
      request.url,
      errorResponse.statusCode,
      errorResponse.body.error.code,
      Date.now() - startTime,
    );

    // Log the error (full details)
    this.logError(exception, errorResponse, request, correlationId);

    // Publish error event for error action handlers (fire and forget)
    if (exception instanceof BaseException) {
      this.errorActionService
        .publishError(exception, {
          correlationId,
          userId: (request as any).user?.id,
          path: request.url,
          method: request.method,
          ...(exception.details || {}),
        })
        .catch((err) => {
          // Don't break error response if action service fails
          this.logger.warn("Failed to publish error event", { error: err });
        });
    }

    // Set response headers
    response.setHeader("X-Correlation-Id", correlationId);

    if (exception instanceof CircuitBreakerOpenError) {
      response.setHeader(
        "Retry-After",
        Math.ceil(exception.retryAfterMs / 1000),
      );
    }

    // Send client-safe response
    response.status(errorResponse.statusCode).json(errorResponse.body);
  }

  private handleException(
    exception: unknown,
    correlationId: string,
    request: Request,
  ): { statusCode: number; body: any } {
    // 1. Handle our custom exceptions
    if (exception instanceof BaseException) {
      return {
        statusCode: exception.httpStatus,
        body: {
          ...exception.toClientResponse(),
          correlationId,
          path: request.url,
        },
      };
    }

    // 2. Handle NestJS HttpExceptions
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      return {
        statusCode: status,
        body: {
          error: {
            code: this.getHttpErrorCode(status),
            message:
              typeof exceptionResponse === "string"
                ? exceptionResponse
                : (exceptionResponse as any).message || "An error occurred",
            timestamp: new Date().toISOString(),
          },
          correlationId,
          path: request.url,
        },
      };
    }

    // 3. Handle unknown errors (NEVER expose details)
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected error occurred. Please try again later.",
          timestamp: new Date().toISOString(),
        },
        correlationId,
        path: request.url,
      },
    };
  }

  private logError(
    exception: unknown,
    errorResponse: { statusCode: number; body: any },
    request: Request,
    correlationId: string,
  ) {
    const logContext = {
      correlationId,
      path: request.url,
      method: request.method,
      statusCode: errorResponse.statusCode,
      userAgent: request.headers["user-agent"],
      ip: request.ip,
      userId: (request as any).user?.id, // If auth middleware sets user
    };

    if (exception instanceof BaseException) {
      // Log structured error
      if (exception.isOperational) {
        // Expected error - log as warning
        this.logger.warn({
          ...logContext,
          error: exception.toLogResponse(),
        });
      } else {
        // Unexpected error - log as error with full stack
        this.logger.error({
          ...logContext,
          error: exception.toLogResponse(),
        });
      }
    } else if (exception instanceof Error) {
      // Unknown error - always log full details
      this.logger.error({
        ...logContext,
        error: {
          name: exception.name,
          message: exception.message,
          stack: exception.stack,
        },
      });
    } else {
      // Non-error throw
      this.logger.error({
        ...logContext,
        error: {
          message: "Unknown error type thrown",
          value: String(exception),
        },
      });
    }
  }

  private getHttpErrorCode(status: number): string {
    const codeMap: Record<number, string> = {
      400: "BAD_REQUEST",
      401: "UNAUTHORIZED",
      403: "FORBIDDEN",
      404: "NOT_FOUND",
      409: "CONFLICT",
      422: "UNPROCESSABLE_ENTITY",
      429: "TOO_MANY_REQUESTS",
      500: "INTERNAL_SERVER_ERROR",
      502: "BAD_GATEWAY",
      503: "SERVICE_UNAVAILABLE",
      504: "GATEWAY_TIMEOUT",
    };
    return codeMap[status] || "UNKNOWN_ERROR";
  }

  private generateCorrelationId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

