import {
  AccountNotFoundError,
  AccountAlreadyExistsError,
  InsufficientFundsError,
  AccountClosedError,
  InvalidAmountError,
  DailyLimitExceededError,
  ConcurrencyError,
  InvalidCurrencyError,
  DomainException,
} from '../../../src/libs/exceptions/domain.exceptions';

describe('Domain Exceptions', () => {
  
  describe('DomainException base class', () => {
    it('should have isOperational = true', () => {
      const error = new AccountNotFoundError('account-123');
      expect(error.isOperational).toBe(true);
    });
  });

  describe('AccountNotFoundError', () => {
    it('should create with correct properties', () => {
      const accountId = 'account-123';
      const error = new AccountNotFoundError(accountId);
      
      expect(error.code).toBe('ACCOUNT_NOT_FOUND');
      expect(error.httpStatus).toBe(404);
      expect(error.message).toContain(accountId);
      expect(error.details?.accountId).toBe(accountId);
      expect(error.isOperational).toBe(true);
    });

    it('should return client-safe message', () => {
      const error = new AccountNotFoundError('account-123');
      const response = error.toClientResponse();
      
      expect(response.error.code).toBe('ACCOUNT_NOT_FOUND');
      expect(response.error.message).toContain('account-123');
    });
  });

  describe('AccountAlreadyExistsError', () => {
    it('should create with correct properties', () => {
      const accountId = 'account-123';
      const error = new AccountAlreadyExistsError(accountId);
      
      expect(error.code).toBe('ACCOUNT_ALREADY_EXISTS');
      expect(error.httpStatus).toBe(409);
      expect(error.message).toContain(accountId);
      expect(error.details?.accountId).toBe(accountId);
    });
  });

  describe('InsufficientFundsError', () => {
    it('should create with correct properties', () => {
      const accountId = 'account-123';
      const requested = 1000;
      const available = 500;
      const error = new InsufficientFundsError(accountId, requested, available);
      
      expect(error.code).toBe('INSUFFICIENT_FUNDS');
      expect(error.httpStatus).toBe(422);
      expect(error.message).toContain('1000');
      expect(error.message).toContain('500');
      expect(error.details?.accountId).toBe(accountId);
      expect(error.details?.requested).toBe(requested);
      expect(error.details?.available).toBe(available);
    });
  });

  describe('AccountClosedError', () => {
    it('should create with correct properties', () => {
      const accountId = 'account-123';
      const error = new AccountClosedError(accountId);
      
      expect(error.code).toBe('ACCOUNT_CLOSED');
      expect(error.httpStatus).toBe(422);
      expect(error.message).toContain(accountId);
      expect(error.details?.accountId).toBe(accountId);
    });
  });

  describe('InvalidAmountError', () => {
    it('should create with correct properties', () => {
      const amount = -100;
      const reason = 'Amount cannot be negative';
      const error = new InvalidAmountError(amount, reason);
      
      expect(error.code).toBe('INVALID_AMOUNT');
      expect(error.httpStatus).toBe(400);
      expect(error.message).toContain('-100');
      expect(error.message).toContain(reason);
      expect(error.details?.amount).toBe(amount);
      expect(error.details?.reason).toBe(reason);
    });
  });

  describe('DailyLimitExceededError', () => {
    it('should create with correct properties', () => {
      const accountId = 'account-123';
      const limit = 5000;
      const attempted = 6000;
      const error = new DailyLimitExceededError(accountId, limit, attempted);
      
      expect(error.code).toBe('DAILY_LIMIT_EXCEEDED');
      expect(error.httpStatus).toBe(422);
      expect(error.message).toBe('Daily transaction limit exceeded');
      expect(error.details?.accountId).toBe(accountId);
      expect(error.details?.limit).toBe(limit);
      expect(error.details?.attempted).toBe(attempted);
    });
  });

  describe('ConcurrencyError', () => {
    it('should create with correct properties', () => {
      const aggregateId = 'aggregate-123';
      const expectedVersion = 5;
      const error = new ConcurrencyError(aggregateId, expectedVersion);
      
      expect(error.code).toBe('CONCURRENCY_CONFLICT');
      expect(error.httpStatus).toBe(409);
      expect(error.message).toContain('Concurrency conflict');
      expect(error.details?.aggregateId).toBe(aggregateId);
      expect(error.details?.expectedVersion).toBe(expectedVersion);
    });
  });

  describe('InvalidCurrencyError', () => {
    it('should create with correct properties', () => {
      const currency = 'XYZ';
      const supportedCurrencies = ['USD', 'EUR', 'GBP'];
      const error = new InvalidCurrencyError(currency, supportedCurrencies);
      
      expect(error.code).toBe('INVALID_CURRENCY');
      expect(error.httpStatus).toBe(400);
      expect(error.message).toContain(currency);
      expect(error.details?.currency).toBe(currency);
      expect(error.details?.supportedCurrencies).toEqual(supportedCurrencies);
    });
  });

  describe('All domain errors should be operational', () => {
    const domainErrors = [
      () => new AccountNotFoundError('id'),
      () => new AccountAlreadyExistsError('id'),
      () => new InsufficientFundsError('id', 100, 50),
      () => new AccountClosedError('id'),
      () => new InvalidAmountError(100, 'reason'),
      () => new DailyLimitExceededError('id', 1000, 2000),
      () => new ConcurrencyError('id', 1),
      () => new InvalidCurrencyError('XYZ', ['USD']),
    ];

    it.each(domainErrors)('should have isOperational = true', (createError) => {
      const error = createError();
      expect(error.isOperational).toBe(true);
    });
  });

  describe('Client response for domain errors', () => {
    it('should expose full message to clients (operational errors)', () => {
      const error = new InsufficientFundsError('account-123', 1000, 500);
      const response = error.toClientResponse();
      
      expect(response.error.message).toBe('Insufficient funds: requested 1000, available 500');
      expect(response.error.message).not.toBe('Service temporarily unavailable');
    });
  });
});

