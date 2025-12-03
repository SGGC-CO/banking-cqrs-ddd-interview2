import {
  ValidationError,
  ValidationFieldError,
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  DuplicateRequestError,
  CommandHandlerNotFoundError,
  QueryHandlerNotFoundError,
  ApplicationException,
} from '../../../src/libs/exceptions/application.exceptions';

describe('Application Exceptions', () => {
  describe('ApplicationException base class', () => {
    it('should have isOperational = true', () => {
      const error = new ValidationError([]);
      expect(error.isOperational).toBe(true);
    });
  });

  describe('ValidationError', () => {
    it('should create with correct properties', () => {
      const errors: ValidationFieldError[] = [
        { field: 'amount', message: 'Amount must be positive', value: -100 },
        { field: 'accountId', message: 'Account ID is required' },
      ];
      const error = new ValidationError(errors);
      
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.httpStatus).toBe(400);
      expect(error.message).toBe('Validation failed');
      expect(error.details?.errors).toEqual(errors);
    });

    it('should handle empty errors array', () => {
      const error = new ValidationError([]);
      expect(error.details?.errors).toEqual([]);
    });

    it('should return client-safe message with details', () => {
      const errors: ValidationFieldError[] = [
        { field: 'amount', message: 'Amount must be positive' },
      ];
      const error = new ValidationError(errors);
      const response = error.toClientResponse();
      
      expect(response.error.code).toBe('VALIDATION_ERROR');
      expect(response.error.message).toBe('Validation failed');
      expect(response.error.details?.errors).toEqual(errors);
    });
  });

  describe('AuthenticationError', () => {
    it('should create with default message', () => {
      const error = new AuthenticationError();
      
      expect(error.code).toBe('AUTHENTICATION_ERROR');
      expect(error.httpStatus).toBe(401);
      expect(error.message).toBe('Authentication required');
    });

    it('should create with custom reason', () => {
      const reason = 'Invalid token';
      const error = new AuthenticationError(reason);
      
      expect(error.code).toBe('AUTHENTICATION_ERROR');
      expect(error.httpStatus).toBe(401);
      expect(error.message).toBe(reason);
    });

    it('should not include details by default', () => {
      const error = new AuthenticationError();
      expect(error.details).toBeUndefined();
    });
  });

  describe('AuthorizationError', () => {
    it('should create with correct properties', () => {
      const resource = 'account';
      const action = 'withdraw';
      const error = new AuthorizationError(resource, action);
      
      expect(error.code).toBe('AUTHORIZATION_ERROR');
      expect(error.httpStatus).toBe(403);
      expect(error.message).toContain(action);
      expect(error.message).toContain(resource);
      expect(error.details?.resource).toBe(resource);
      expect(error.details?.action).toBe(action);
    });
  });

  describe('RateLimitError', () => {
    it('should create with correct properties', () => {
      const retryAfterSeconds = 60;
      const error = new RateLimitError(retryAfterSeconds);
      
      expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(error.httpStatus).toBe(429);
      expect(error.message).toContain(retryAfterSeconds.toString());
      expect(error.details?.retryAfterSeconds).toBe(retryAfterSeconds);
      expect(error.retryAfterSeconds).toBe(retryAfterSeconds);
    });

    it('should include retryAfterSeconds in message', () => {
      const error = new RateLimitError(30);
      expect(error.message).toBe('Rate limit exceeded. Retry after 30 seconds');
    });
  });

  describe('DuplicateRequestError', () => {
    it('should create with correct properties', () => {
      const idempotencyKey = 'req-123-abc';
      const error = new DuplicateRequestError(idempotencyKey);
      
      expect(error.code).toBe('DUPLICATE_REQUEST');
      expect(error.httpStatus).toBe(409);
      expect(error.message).toBe('Duplicate request detected');
      expect(error.details?.idempotencyKey).toBe(idempotencyKey);
    });
  });

  describe('CommandHandlerNotFoundError', () => {
    it('should create with correct properties', () => {
      const commandName = 'DepositCommand';
      const error = new CommandHandlerNotFoundError(commandName);
      
      expect(error.code).toBe('COMMAND_HANDLER_NOT_FOUND');
      expect(error.httpStatus).toBe(500);
      expect(error.message).toContain(commandName);
      expect(error.details?.commandName).toBe(commandName);
    });
  });

  describe('QueryHandlerNotFoundError', () => {
    it('should create with correct properties', () => {
      const queryName = 'GetAccountQuery';
      const error = new QueryHandlerNotFoundError(queryName);
      
      expect(error.code).toBe('QUERY_HANDLER_NOT_FOUND');
      expect(error.httpStatus).toBe(500);
      expect(error.message).toContain(queryName);
      expect(error.details?.queryName).toBe(queryName);
    });
  });

  describe('All application errors should be operational', () => {
    const applicationErrors = [
      () => new ValidationError([]),
      () => new AuthenticationError(),
      () => new AuthorizationError('resource', 'action'),
      () => new RateLimitError(60),
      () => new DuplicateRequestError('key'),
      () => new CommandHandlerNotFoundError('command'),
      () => new QueryHandlerNotFoundError('query'),
    ];

    it.each(applicationErrors)('should have isOperational = true', (createError) => {
      const error = createError();
      expect(error.isOperational).toBe(true);
    });
  });

  describe('Client response for application errors', () => {
    it('should expose full message to clients (operational errors)', () => {
      const error = new ValidationError([
        { field: 'amount', message: 'Must be positive' }
      ]);
      const response = error.toClientResponse();
      
      expect(response.error.message).toBe('Validation failed');
      expect(response.error.message).not.toBe('Service temporarily unavailable');
    });

    it('should include validation details for ValidationError', () => {
      const errors: ValidationFieldError[] = [
        { field: 'amount', message: 'Must be positive', value: -100 },
      ];
      const error = new ValidationError(errors);
      const response = error.toClientResponse();
      
      expect(response.error.details?.errors).toEqual(errors);
    });

    it('should include retryAfterSeconds for RateLimitError', () => {
      const error = new RateLimitError(120);
      const response = error.toClientResponse();
      
      expect(response.error.message).toContain('120');
      expect(response.error.details?.retryAfterSeconds).toBe(120);
    });
  });

  describe('HTTP status codes', () => {
    it('should use correct status codes', () => {
      expect(new ValidationError([]).httpStatus).toBe(400);
      expect(new AuthenticationError().httpStatus).toBe(401);
      expect(new AuthorizationError('r', 'a').httpStatus).toBe(403);
      expect(new RateLimitError(60).httpStatus).toBe(429);
      expect(new DuplicateRequestError('key').httpStatus).toBe(409);
      expect(new CommandHandlerNotFoundError('cmd').httpStatus).toBe(500);
      expect(new QueryHandlerNotFoundError('qry').httpStatus).toBe(500);
    });
  });
});

