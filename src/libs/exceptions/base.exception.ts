/**
 * Base exception for all application errors.
 * Provides consistent structure for error handling.
 */
export abstract class BaseException extends Error {
  abstract readonly code: string;           // Machine-readable error code
  abstract readonly httpStatus: number;     // HTTP status code
  abstract readonly isOperational: boolean; // true = expected, false = bug
  
  readonly timestamp: string;
  readonly correlationId?: string;
  
  constructor(
    message: string,
    public readonly details?: Record<string, any>,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date().toISOString();
    
    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Safe response for client (no sensitive data)
   */
  toClientResponse(): ClientErrorResponse {
    // For infrastructure errors, don't expose internal details to clients
    const clientMessage = this.isOperational 
      ? this.message  // Domain/Application errors: show full message
      : this.getGenericClientMessage(); // Infrastructure errors: generic message

    return {
      error: {
        code: this.code,
        message: clientMessage,
        timestamp: this.timestamp,
        ...(this.details && { details: this.sanitizeDetails(this.details) }),
      },
    };
  }

  /**
   * Get generic message for infrastructure errors (don't expose internal details)
   */
  private getGenericClientMessage(): string {
    switch (this.httpStatus) {
      case 503:
        return 'Service temporarily unavailable. Please try again later.';
      case 504:
        return 'Request timeout. Please try again later.';
      case 502:
        return 'Service error. Please try again later.';
      default:
        return 'An unexpected error occurred. Please try again later.';
    }
  }

  /**
   * Full response for logging (includes sensitive data)
   */
  toLogResponse(): LogErrorResponse {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
      isOperational: this.isOperational,
      timestamp: this.timestamp,
      details: this.details,
      stack: this.stack,
      cause: this.cause?.message,
    };
  }

  private sanitizeDetails(details: Record<string, any>): Record<string, any> {
    // Remove sensitive fields
    const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'ssn'];
    const sanitized = { ...details };
    
    for (const field of sensitiveFields) {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }
}

export interface ClientErrorResponse {
  error: {
    code: string;
    message: string;
    timestamp: string;
    details?: Record<string, any>;
  };
}

export interface LogErrorResponse {
  name: string;
  code: string;
  message: string;
  httpStatus: number;
  isOperational: boolean;
  timestamp: string;
  details?: Record<string, any>;
  stack?: string;
  cause?: string;
}

