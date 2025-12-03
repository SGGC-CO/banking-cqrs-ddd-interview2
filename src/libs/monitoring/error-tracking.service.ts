import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseException } from '../exceptions/base.exception';
import { getCorrelationId } from '../correlation/correlation.middleware';

@Injectable()
export class ErrorTrackingService implements OnModuleInit {
  private readonly logger = new Logger(ErrorTrackingService.name);
  private sentryAvailable = false;
  private Sentry: any = null; // Store Sentry reference for performance

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    // Check if Sentry is available (optional dependency)
    try {
      // Dynamic import to avoid requiring @sentry/node as mandatory dependency
      // This makes Sentry optional - if not installed, tracking will use logger only
      // Store reference to avoid repeated require() calls (even though require is cached)
      this.Sentry = require('@sentry/node');
      
      const sentryDsn = this.configService.get<string>('SENTRY_DSN');
      if (sentryDsn) {
        this.Sentry.init({
          dsn: sentryDsn,
          environment: this.configService.get<string>('NODE_ENV', 'development'),
          tracesSampleRate: parseFloat(
            this.configService.get<string>('SENTRY_TRACES_SAMPLE_RATE', '0.1')
          ),
          beforeSend: (event: any, hint: any) => {
            // Don't send operational errors (expected errors)
            const error = hint?.originalException;
            if (error instanceof BaseException && error.isOperational) {
              return null;
            }
            return event;
          },
        });
        this.sentryAvailable = true;
        this.logger.log('Sentry error tracking initialized');
      } else {
        this.logger.warn('SENTRY_DSN not configured - Sentry tracking disabled');
        this.Sentry = null; // Clear reference if not configured
      }
    } catch (error) {
      this.logger.warn('Sentry not available - error tracking will use logger only');
      this.Sentry = null; // Clear reference on error
    }
  }

  captureException(error: Error, context?: Record<string, any>) {
    const correlationId = getCorrelationId();
    
    // Use stored Sentry reference (performance optimization - avoid repeated require)
    if (this.sentryAvailable && this.Sentry) {
      try {
        this.Sentry.withScope((scope: any) => {
          // Add correlation ID
          if (correlationId) {
            scope.setTag('correlationId', correlationId);
          }

          // Add custom context
          if (context) {
            scope.setExtras(context);
            
            // Add tags from context for better filtering in Sentry dashboards
            if (context.path) scope.setTag('path', context.path);
            if (context.method) scope.setTag('method', context.method);
            if (context.statusCode) scope.setTag('statusCode', String(context.statusCode));
          }

          // Add error classification
          if (error instanceof BaseException) {
            scope.setTag('errorCode', error.code);
            scope.setTag('isOperational', String(error.isOperational));
            scope.setTag('httpStatus', String(error.httpStatus));
            scope.setLevel(error.isOperational ? 'warning' : 'error');
            
            // Add error category for grouping
            if (error.name.includes('Domain')) {
              scope.setTag('errorCategory', 'domain');
            } else if (error.name.includes('Infrastructure')) {
              scope.setTag('errorCategory', 'infrastructure');
            } else if (error.name.includes('Application')) {
              scope.setTag('errorCategory', 'application');
            }
          }

          this.Sentry.captureException(error);
        });
        return;
      } catch (err) {
        this.logger.warn('Failed to send error to Sentry, falling back to logger');
      }
    }

    // Fallback: Log to console/logger
    const logContext = {
      correlationId,
      ...context,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    };

    if (error instanceof BaseException && error.isOperational) {
      this.logger.warn(logContext);
    } else {
      this.logger.error(logContext);
    }
  }

  captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
    const correlationId = getCorrelationId();

    // Use stored Sentry reference (performance optimization - avoid repeated require)
    if (this.sentryAvailable && this.Sentry) {
      try {
        this.Sentry.withScope((scope: any) => {
          if (correlationId) {
            scope.setTag('correlationId', correlationId);
          }
          this.Sentry.captureMessage(message, level);
        });
        return;
      } catch (err) {
        this.logger.warn('Failed to send message to Sentry');
      }
    }

    // Fallback: Log to console/logger
    const logContext = { correlationId, message };
    if (level === 'error') {
      this.logger.error(logContext);
    } else if (level === 'warning') {
      this.logger.warn(logContext);
    } else {
      this.logger.log(logContext);
    }
  }
}

