import { BaseException } from '../../../src/libs/exceptions/base.exception';

// Create a concrete implementation for testing
class TestException extends BaseException {
  readonly code = 'TEST_ERROR';
  readonly httpStatus = 500;
  readonly isOperational = true;
}

describe('BaseException', () => {
  describe('constructor', () => {
    it('should set message correctly', () => {
      const error = new TestException('Test message');
      expect(error.message).toBe('Test message');
    });

    it('should set name to class name', () => {
      const error = new TestException('Test message');
      expect(error.name).toBe('TestException');
    });

    it('should generate timestamp', () => {
      const before = new Date().toISOString();
      const error = new TestException('Test message');
      const after = new Date().toISOString();
      
      expect(error.timestamp).toBeDefined();
      expect(error.timestamp >= before).toBe(true);
      expect(error.timestamp <= after).toBe(true);
    });

    it('should set details when provided', () => {
      const details = { field1: 'value1', field2: 123 };
      const error = new TestException('Test message', details);
      
      expect(error.details).toEqual(details);
    });

    it('should set cause when provided', () => {
      const cause = new Error('Original error');
      const error = new TestException('Test message', undefined, cause);
      
      expect(error.cause).toBe(cause);
    });

    it('should capture stack trace', () => {
      const error = new TestException('Test message');
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('TestException');
    });
  });

  describe('toClientResponse', () => {
    it('should return operational error with full message', () => {
      const error = new TestException('Operational error message');
      const response = error.toClientResponse();
      
      expect(response.error.code).toBe('TEST_ERROR');
      expect(response.error.message).toBe('Operational error message');
      expect(response.error.timestamp).toBeDefined();
    });

    it('should include details in client response', () => {
      const details = { accountId: '123', amount: 100 };
      const error = new TestException('Test message', details);
      const response = error.toClientResponse();
      
      expect(response.error.details).toEqual(details);
    });

    it('should sanitize sensitive fields in details', () => {
      const details = {
        password: 'secret123',
        token: 'jwt-token',
        apiKey: 'key-123',
        ssn: '123-45-6789',
        normalField: 'safe-value'
      };
      const error = new TestException('Test message', details);
      const response = error.toClientResponse();
      
      expect(response.error.details?.password).toBe('[REDACTED]');
      expect(response.error.details?.token).toBe('[REDACTED]');
      expect(response.error.details?.apiKey).toBe('[REDACTED]');
      expect(response.error.details?.ssn).toBe('[REDACTED]');
      expect(response.error.details?.normalField).toBe('safe-value');
    });

    it('should not include details if not provided', () => {
      const error = new TestException('Test message');
      const response = error.toClientResponse();
      
      expect(response.error.details).toBeUndefined();
    });
  });

  describe('toLogResponse', () => {
    it('should return full error details for logging', () => {
      const cause = new Error('Original error');
      const error = new TestException('Test message', { key: 'value' }, cause);
      const logResponse = error.toLogResponse();
      
      expect(logResponse.name).toBe('TestException');
      expect(logResponse.code).toBe('TEST_ERROR');
      expect(logResponse.message).toBe('Test message');
      expect(logResponse.httpStatus).toBe(500);
      expect(logResponse.isOperational).toBe(true);
      expect(logResponse.timestamp).toBeDefined();
      expect(logResponse.details).toEqual({ key: 'value' });
      expect(logResponse.stack).toBeDefined();
      expect(logResponse.cause).toBe('Original error');
    });

    it('should handle missing optional fields', () => {
      const error = new TestException('Test message');
      const logResponse = error.toLogResponse();
      
      expect(logResponse.details).toBeUndefined();
      expect(logResponse.cause).toBeUndefined();
    });
  });

  describe('generic client messages for non-operational errors', () => {
    class NonOperationalError extends BaseException {
      readonly code = 'NON_OPERATIONAL';
      readonly httpStatus = 503;
      readonly isOperational = false;
    }

    it('should return generic message for 503 errors', () => {
      const error = new NonOperationalError('Internal database error');
      const response = error.toClientResponse();
      
      expect(response.error.message).toBe('Service temporarily unavailable. Please try again later.');
      expect(response.error.message).not.toContain('database');
    });

    it('should return generic message for 504 errors', () => {
      class TimeoutError extends BaseException {
        readonly code = 'TIMEOUT';
        readonly httpStatus = 504;
        readonly isOperational = false;
      }
      
      const error = new TimeoutError('Request timed out');
      const response = error.toClientResponse();
      
      expect(response.error.message).toBe('Request timeout. Please try again later.');
    });

    it('should return generic message for 502 errors', () => {
      class BadGatewayError extends BaseException {
        readonly code = 'BAD_GATEWAY';
        readonly httpStatus = 502;
        readonly isOperational = false;
      }
      
      const error = new BadGatewayError('External service failed');
      const response = error.toClientResponse();
      
      expect(response.error.message).toBe('Service error. Please try again later.');
    });

    it('should return default generic message for other non-operational errors', () => {
      class OtherError extends BaseException {
        readonly code = 'OTHER';
        readonly httpStatus = 500;
        readonly isOperational = false;
      }
      
      const error = new OtherError('Unexpected error');
      const response = error.toClientResponse();
      
      expect(response.error.message).toBe('An unexpected error occurred. Please try again later.');
    });
  });
});

