import {
  DatabaseConnectionError,
  DatabaseQueryError,
  DatabaseTimeoutError,
  CircuitBreakerOpenError,
  CacheConnectionError,
  ExternalServiceError,
  ExternalServiceTimeoutError,
  MessageQueueError,
  InfrastructureException,
} from '../../../src/libs/exceptions/infrastructure.exceptions';

describe('Infrastructure Exceptions', () => {
  describe('InfrastructureException base class', () => {
    it('should have isOperational = false', () => {
      const error = new DatabaseConnectionError('MongoDB');
      expect(error.isOperational).toBe(false);
    });
  });

  describe('DatabaseConnectionError', () => {
    it('should create with correct properties', () => {
      const database = 'MongoDB';
      const error = new DatabaseConnectionError(database);
      
      expect(error.code).toBe('DATABASE_CONNECTION_ERROR');
      expect(error.httpStatus).toBe(503);
      expect(error.message).toContain(database);
      expect(error.details?.database).toBe(database);
      expect(error.retryAfterMs).toBe(10000); // default
      expect(error.isOperational).toBe(false);
    });

    it('should accept custom retryAfterMs', () => {
      const error = new DatabaseConnectionError('MongoDB', undefined, 5000);
      expect(error.retryAfterMs).toBe(5000);
    });

    it('should accept cause error', () => {
      const cause = new Error('Connection refused');
      const error = new DatabaseConnectionError('MongoDB', cause);
      
      expect(error.cause).toBe(cause);
    });

    it('should return generic client message (non-operational)', () => {
      const error = new DatabaseConnectionError('MongoDB');
      const response = error.toClientResponse();
      
      expect(response.error.message).toBe('Service temporarily unavailable. Please try again later.');
      expect(response.error.message).not.toContain('MongoDB');
    });
  });

  describe('DatabaseQueryError', () => {
    it('should create with correct properties', () => {
      const operation = 'find';
      const collection = 'accounts';
      const error = new DatabaseQueryError(operation, collection);
      
      expect(error.code).toBe('DATABASE_QUERY_ERROR');
      expect(error.httpStatus).toBe(500);
      expect(error.message).toContain(operation);
      expect(error.message).toContain(collection);
      expect(error.details?.operation).toBe(operation);
      expect(error.details?.collection).toBe(collection);
    });

    it('should accept cause error', () => {
      const cause = new Error('Query failed');
      const error = new DatabaseQueryError('find', 'accounts', cause);
      
      expect(error.cause).toBe(cause);
    });
  });

  describe('DatabaseTimeoutError', () => {
    it('should create with correct properties', () => {
      const operation = "timed out";
      const timeoutMs = 5000;
      const error = new DatabaseTimeoutError(operation, timeoutMs);
      
      expect(error.code).toBe('DATABASE_TIMEOUT');
      expect(error.httpStatus).toBe(504);
      expect(error.message).toContain(operation);
      expect(error.message).toContain(timeoutMs.toString());
      expect(error.details?.operation).toBe(operation);
      expect(error.details?.timeoutMs).toBe(timeoutMs);
    });
  });

  describe('CircuitBreakerOpenError', () => {
    it('should create with correct properties', () => {
      const serviceName = 'DatabaseService';
      const retryAfterMs = 15000;
      const error = new CircuitBreakerOpenError(serviceName, retryAfterMs);
      
      expect(error.code).toBe('CIRCUIT_BREAKER_OPEN');
      expect(error.httpStatus).toBe(503);
      expect(error.message).toContain(serviceName);
      expect(error.details?.serviceName).toBe(serviceName);
      expect(error.details?.retryAfterMs).toBe(retryAfterMs);
      expect(error.retryAfterMs).toBe(retryAfterMs);
    });

    it('should use default retryAfterMs if not provided', () => {
      const error = new CircuitBreakerOpenError('DatabaseService');
      expect(error.retryAfterMs).toBe(10000);
    });

    it('should return generic client message', () => {
      const error = new CircuitBreakerOpenError('DatabaseService');
      const response = error.toClientResponse();
      
      expect(response.error.message).toBe('Service temporarily unavailable. Please try again later.');
    });
  });

  describe('CacheConnectionError', () => {
    it('should create with correct properties', () => {
      const cacheType = 'Redis';
      const retryAfterMs = 8000;
      const error = new CacheConnectionError(cacheType, undefined, retryAfterMs);
      
      expect(error.code).toBe('CACHE_CONNECTION_ERROR');
      expect(error.httpStatus).toBe(503);
      expect(error.message).toContain(cacheType);
      expect(error.details?.cacheType).toBe(cacheType);
      expect(error.retryAfterMs).toBe(retryAfterMs);
    });

    it('should use default retryAfterMs if not provided', () => {
      const error = new CacheConnectionError('Redis');
      expect(error.retryAfterMs).toBe(10000);
    });
  });

  describe('ExternalServiceError', () => {
    it('should create with correct properties', () => {
      const serviceName = 'PaymentGateway';
      const statusCode = 500;
      const error = new ExternalServiceError(serviceName, statusCode);
      
      expect(error.code).toBe('EXTERNAL_SERVICE_ERROR');
      expect(error.httpStatus).toBe(502);
      expect(error.message).toContain(serviceName);
      expect(error.message).toContain(statusCode.toString());
      expect(error.details?.serviceName).toBe(serviceName);
      expect(error.details?.statusCode).toBe(statusCode);
    });

    it('should accept cause error', () => {
      const cause = new Error('Network error');
      const error = new ExternalServiceError('PaymentGateway', 500, cause);
      
      expect(error.cause).toBe(cause);
    });

    it('should return generic client message for 502', () => {
      const error = new ExternalServiceError('PaymentGateway', 500);
      const response = error.toClientResponse();
      
      expect(response.error.message).toBe('Service error. Please try again later.');
    });
  });

  describe('ExternalServiceTimeoutError', () => {
    it('should create with correct properties', () => {
      const serviceName = 'PaymentGateway';
      const timeoutMs = 30000;
      const error = new ExternalServiceTimeoutError(serviceName, timeoutMs);
      
      expect(error.code).toBe('EXTERNAL_SERVICE_TIMEOUT');
      expect(error.httpStatus).toBe(504);
      expect(error.message).toContain(serviceName);
      expect(error.message).toContain(timeoutMs.toString());
      expect(error.details?.serviceName).toBe(serviceName);
      expect(error.details?.timeoutMs).toBe(timeoutMs);
    });
  });

  describe('MessageQueueError', () => {
    it('should create with correct properties', () => {
      const queue = 'deposit-queue';
      const operation = 'publish';
      const retryAfterMs = 12000;
      const error = new MessageQueueError(queue, operation, undefined, retryAfterMs);
      
      expect(error.code).toBe('MESSAGE_QUEUE_ERROR');
      expect(error.httpStatus).toBe(503);
      expect(error.message).toContain(queue);
      expect(error.message).toContain(operation);
      expect(error.details?.queue).toBe(queue);
      expect(error.details?.operation).toBe(operation);
      expect(error.retryAfterMs).toBe(retryAfterMs);
    });

    it('should use default retryAfterMs if not provided', () => {
      const error = new MessageQueueError('queue', 'publish');
      expect(error.retryAfterMs).toBe(10000);
    });

    it('should accept cause error', () => {
      const cause = new Error('Queue connection failed');
      const error = new MessageQueueError('queue', 'publish', cause);
      
      expect(error.cause).toBe(cause);
    });
  });

  describe('All infrastructure errors should be non-operational', () => {
    const infrastructureErrors = [
      () => new DatabaseConnectionError('DB'),
      () => new DatabaseQueryError('op', 'collection'),
      () => new DatabaseTimeoutError('op', 1000),
      () => new CircuitBreakerOpenError('service'),
      () => new CacheConnectionError('cache'),
      () => new ExternalServiceError('service', 500),
      () => new ExternalServiceTimeoutError('service', 1000),
      () => new MessageQueueError('queue', 'op'),
    ];

    it.each(infrastructureErrors)('should have isOperational = false', (createError) => {
      const error = createError();
      expect(error.isOperational).toBe(false);
    });
  });

  describe('503 errors should have retryAfterMs', () => {
    it('should have retryAfterMs for DatabaseConnectionError', () => {
      const error = new DatabaseConnectionError('DB', undefined, 5000);
      expect(error.retryAfterMs).toBeDefined();
      expect(typeof error.retryAfterMs).toBe('number');
    });

    it('should have retryAfterMs for CircuitBreakerOpenError', () => {
      const error = new CircuitBreakerOpenError('service', 8000);
      expect(error.retryAfterMs).toBeDefined();
      expect(typeof error.retryAfterMs).toBe('number');
    });

    it('should have retryAfterMs for CacheConnectionError', () => {
      const error = new CacheConnectionError('cache', undefined, 6000);
      expect(error.retryAfterMs).toBeDefined();
      expect(typeof error.retryAfterMs).toBe('number');
    });

    it('should have retryAfterMs for MessageQueueError', () => {
      const error = new MessageQueueError('queue', 'op', undefined, 7000);
      expect(error.retryAfterMs).toBeDefined();
      expect(typeof error.retryAfterMs).toBe('number');
    });
  });
});

