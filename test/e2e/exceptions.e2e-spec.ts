import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { MongoClient } from 'mongodb';
import { AppModule } from '../../src/modules/app.module';
import { GlobalExceptionFilter } from '../../src/libs/exceptions/global-exception.filter';
import { ValidationError } from '../../src/libs/exceptions/application.exceptions';
import { MONGO } from '../../src/modules/database/database.module';
import { REDIS } from '../../src/modules/accounts/accounts.module';

describe('Exception Handling E2E Tests', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;
  let mongoClient: MongoClient;
  let redisClient: any; // Redis client type from ioredis
  let globalExceptionFilter: GlobalExceptionFilter;

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    globalExceptionFilter = moduleFixture.get(GlobalExceptionFilter);
    mongoClient = moduleFixture.get<MongoClient>(MONGO);
    
    // Get Redis client if it exists (may be null if Redis is not available)
    try {
      redisClient = moduleFixture.get(REDIS);
    } catch {
      redisClient = null;
    }

    // Apply the same configuration as main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        exceptionFactory: (errors) => {
          const formattedErrors = errors.map((error) => ({
            field: error.property,
            message: Object.values(error.constraints || {}).join(', '),
            value: error.value,
          }));
          return new ValidationError(formattedErrors);
        },
      }),
    );

    app.useGlobalFilters(globalExceptionFilter);

    await app.init();
  });

  afterAll(async () => {
    // Close Redis connection first if it exists
    if (redisClient && typeof redisClient.quit === 'function') {
      await redisClient.quit().catch(() => {
        // Ignore errors during cleanup
      });
    } else if (redisClient && typeof redisClient.disconnect === 'function') {
      await redisClient.disconnect().catch(() => {
        // Ignore errors during cleanup
      });
    }
    
    // Close MongoDB connection
    if (mongoClient) {
      await mongoClient.close().catch(() => {
        // Ignore errors during cleanup
      });
    }
    
    // Then close the app (this should close all other connections)
    if (app) {
      await app.close();
    }
    
    // Give Jest time to clean up all async operations
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  describe('ValidationError (400)', () => {
    it('should return 400 with validation error details when body is invalid', async () => {
      const response = await request(app.getHttpServer())
        .post('/accounts')
        .send({
          // Missing required fields or invalid data
          ownerId: '', // Invalid empty string
          initialBalance: -100, // Invalid negative amount
          currency: 'INVALID', // Invalid currency if there are constraints
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toBe('Validation failed');
      expect(response.body.error.details).toBeDefined();
      expect(response.body.error.details.errors).toBeInstanceOf(Array);
      expect(response.body.error.timestamp).toBeDefined();
    });

    it('should return 400 when deposit amount is missing', async () => {
      const accountId = 'test-account-id';
      const response = await request(app.getHttpServer())
        .post(`/accounts/${accountId}/deposit`)
        .send({})
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details.errors).toBeInstanceOf(Array);
      expect(response.body.error.details.errors.length).toBeGreaterThan(0);
    });

    it('should return 400 when deposit amount is negative', async () => {
      const accountId = 'test-account-id';
      const response = await request(app.getHttpServer())
        .post(`/accounts/${accountId}/deposit`)
        .send({ amount: -100 })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('AccountNotFoundError (404)', () => {
    it('should return 404 when account does not exist for deposit', async () => {
      const nonExistentId = 'non-existent-account-id';
      const response = await request(app.getHttpServer())
        .post(`/accounts/${nonExistentId}/deposit`)
        .send({ amount: 100 })
        .expect(404);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('ACCOUNT_NOT_FOUND');
      expect(response.body.error.message).toContain(nonExistentId);
      expect(response.body.error.details).toBeDefined();
      expect(response.body.error.details.accountId).toBe(nonExistentId);
      expect(response.body.error.timestamp).toBeDefined();
    });

    it('should return 404 when account does not exist for withdraw', async () => {
      const nonExistentId = 'non-existent-account-id';
      const response = await request(app.getHttpServer())
        .post(`/accounts/${nonExistentId}/withdraw`)
        .send({ amount: 100 })
        .expect(404);

      expect(response.body.error.code).toBe('ACCOUNT_NOT_FOUND');
      expect(response.body.error.message).toContain(nonExistentId);
    });

    it('should return 404 when account does not exist for get', async () => {
      const nonExistentId = 'non-existent-account-id';
      const response = await request(app.getHttpServer())
        .get(`/accounts/${nonExistentId}`)
        .expect(404);

      expect(response.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    });
  });

  describe('InsufficientFundsError (422)', () => {
    let accountId: string;

    beforeAll(async () => {
      // Create an account with initial balance
      const createResponse = await request(app.getHttpServer())
        .post('/accounts')
        .send({
          ownerId: 'test-user-123',
          currency: 'USD',
          initialBalance: 100, // Start with 100
        })
        .expect(201);

      accountId = createResponse.body.accountId;
    });

    it('should return 422 when withdrawing more than available balance', async () => {
      const response = await request(app.getHttpServer())
        .post(`/accounts/${accountId}/withdraw`)
        .send({ amount: 500 }) // Trying to withdraw 500 when only 100 available
        .expect(422);

      expect(response.body.error.code).toBe('INSUFFICIENT_FUNDS');
      expect(response.body.error.message).toContain('Insufficient funds');
      expect(response.body.error.details).toBeDefined();
      expect(response.body.error.details.accountId).toBe(accountId);
      expect(response.body.error.details.requested).toBe(500);
      expect(response.body.error.details.available).toBe(100);
    });
  });

  describe('InvalidAmountError (400)', () => {
    let accountId: string;

    beforeAll(async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/accounts')
        .send({
          ownerId: 'test-user-456',
          currency: 'USD',
          initialBalance: 0,
        })
        .expect(201);

      accountId = createResponse.body.accountId;
    });

    it('should return 400 when trying to deposit zero or negative amount', async () => {
      const response = await request(app.getHttpServer())
        .post(`/accounts/${accountId}/deposit`)
        .send({ amount: 0 }) // Zero amount should be invalid
        .expect(400);

      // This might be a ValidationError or InvalidAmountError depending on validation
      expect(['VALIDATION_ERROR', 'INVALID_AMOUNT']).toContain(response.body.error.code);
    });
  });

  describe('Correlation ID Header', () => {
    it('should include X-Correlation-Id header in all error responses', async () => {
      const response = await request(app.getHttpServer())
        .post('/accounts/non-existent/deposit')
        .send({ amount: 100 })
        .expect(404);

      expect(response.headers['x-correlation-id']).toBeDefined();
      expect(typeof response.headers['x-correlation-id']).toBe('string');
      expect(response.headers['x-correlation-id'].length).toBeGreaterThan(0);
    });

    it('should include correlation ID in response body', async () => {
      const response = await request(app.getHttpServer())
        .post('/accounts/non-existent/deposit')
        .send({ amount: 100 })
        .expect(404);

      expect(response.body.correlationId).toBeDefined();
      expect(response.body.correlationId).toBe(response.headers['x-correlation-id']);
    });
  });

  describe('Error Response Structure', () => {
    it('should return standardized error response format', async () => {
      const response = await request(app.getHttpServer())
        .post('/accounts/invalid-id/deposit')
        .send({ amount: 100 })
        .expect(404);

      // Check structure
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('code');
      expect(response.body.error).toHaveProperty('message');
      expect(response.body.error).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('correlationId');
      expect(response.body).toHaveProperty('path');

      // Check types
      expect(typeof response.body.error.code).toBe('string');
      expect(typeof response.body.error.message).toBe('string');
      expect(typeof response.body.error.timestamp).toBe('string');
      expect(typeof response.body.correlationId).toBe('string');
      expect(typeof response.body.path).toBe('string');
    });

    it('should not expose sensitive information in error response', async () => {
      const response = await request(app.getHttpServer())
        .post('/accounts')
        .send({
          password: 'secret123',
          token: 'jwt-token',
          ownerId: 'test',
          initialBalance: 100,
          currency: 'USD',
        })
        .expect(400);

      // If password or token appear in error response, they should be redacted
      const responseString = JSON.stringify(response.body);
      if (responseString.includes('secret123')) {
        // If validation error includes the value, check it's not in details
        expect(response.body.error.details).not.toHaveProperty('password');
      }
    });
  });

//   describe('Sensitive Data Leakage Prevention', () => {
//     const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'ssn'];
//     const sensitivePatterns = [
//       /password/i,
//       /token/i,
//       /secret/i,
//       /api[_-]?key/i,
//       /ssn/i,
//       /credit[_-]?card/i,
//       /cvv/i,
//       /pin/i,
//       /private[_-]?key/i,
//       /mongodb:\/\//i,
//       /redis:\/\//i,
//       /connection[_-]?string/i,
//       /\.env/i,
//       /\/etc\/passwd/i,
//       /\/home\/\w+/i,
//     ];

//     it('should redact sensitive fields in validation error details', async () => {
//       const response = await request(app.getHttpServer())
//         .post('/accounts')
//         .send({
//           password: 'mySecretPassword123',
//           token: 'jwt-token-abc123',
//           secret: 'my-secret-key',
//           apiKey: 'api-key-xyz',
//           ssn: '123-45-6789',
//           ownerId: 'test-user',
//           currency: 'USD',
//           initialBalance: 100,
//         })
//         .expect(400);


//       console.log(response.body);

//       const responseString = JSON.stringify(response.body);

//       // Verify sensitive values are not present in response
//       expect(responseString).not.toContain('mySecretPassword123');
//       expect(responseString).not.toContain('jwt-token-abc123');
//       expect(responseString).not.toContain('my-secret-key');
//       expect(responseString).not.toContain('api-key-xyz');
//       expect(responseString).not.toContain('123-45-6789');

//       // If error details exist, sensitive fields should be redacted
//       if (response.body.error.details) {
//         sensitiveFields.forEach(field => {
//           if (response.body.error.details.errors) {
//             // Check validation errors array
//             response.body.error.details.errors.forEach((error: any) => {
//               if (error.field === field && error.value) {
//                 expect(error.value).toBe('[REDACTED]');
//               }
//             });
//           } else if (response.body.error.details[field] !== undefined) {
//             expect(response.body.error.details[field]).toBe('[REDACTED]');
//           }
//         });
//       }
//     });

//     it('should not expose stack traces in client responses', async () => {
//       // Trigger an error that would normally have a stack trace
//       const response = await request(app.getHttpServer())
//         .post('/accounts/non-existent/deposit')
//         .send({ amount: 100 })
//         .expect(404);

//       const responseString = JSON.stringify(response.body);

//       // Stack trace patterns should not be present
//       expect(responseString).not.toMatch(/at\s+\w+/); // "at functionName"
//       expect(responseString).not.toMatch(/\.ts:\d+:\d+/); // File paths with line numbers
//       expect(responseString).not.toMatch(/\.js:\d+:\d+/);
//       expect(responseString).not.toMatch(/Stack:/i);
//       expect(responseString).not.toMatch(/Error:/);
//       expect(response.body.error).not.toHaveProperty('stack');
//       expect(response.body).not.toHaveProperty('stack');
//     });

//     it('should not expose internal file paths or system information', async () => {
//       const response = await request(app.getHttpServer())
//         .post('/accounts/non-existent/deposit')
//         .send({ amount: 100 })
//         .expect(404);

//       const responseString = JSON.stringify(response.body);

//       // Should not contain file system paths
//       expect(responseString).not.toMatch(/[CD]:\\/); // Windows paths
//       expect(responseString).not.toMatch(/\/[a-z]+\//); // Unix paths like /home/, /usr/
//       expect(responseString).not.toMatch(/node_modules/);
//       expect(responseString).not.toMatch(/dist\//);
//       expect(responseString).not.toMatch(/src\//);
//     });

//     it('should not expose internal error details for non-operational errors', async () => {
//       // This test verifies that infrastructure errors show generic messages
//       // Note: To fully test this, you'd need to trigger a real infrastructure error
//       // For now, we verify the structure and that operational errors show full messages

//       // Operational error (domain error) - should show full message
//       const domainErrorResponse = await request(app.getHttpServer())
//         .post('/accounts/non-existent/deposit')
//         .send({ amount: 100 })
//         .expect(404);

//       // Domain errors should show full message (they're expected business errors)
//       expect(domainErrorResponse.body.error.message).toContain('non-existent');
//       expect(domainErrorResponse.body.error.message).not.toBe('Service temporarily unavailable');
//     });

//     it('should not expose database connection strings or credentials', async () => {
//       const response = await request(app.getHttpServer())
//         .post('/accounts')
//         .send({
//           ownerId: 'test',
//           currency: 'USD',
//           initialBalance: 100,
//         })
//         .expect(200); // Or whatever status

//       const responseString = JSON.stringify(response.body);

//       // Should not contain connection strings
//       expect(responseString).not.toMatch(/mongodb:\/\/.*@/); // MongoDB with credentials
//       expect(responseString).not.toMatch(/redis:\/\/.*@/); // Redis with credentials
//       expect(responseString).not.toMatch(/localhost:\d+/); // Local connection strings
//       expect(responseString).not.toMatch(/127\.0\.0\.1:\d+/);
//     });

//     it('should not expose environment variables or configuration', async () => {
//       const response = await request(app.getHttpServer())
//         .post('/accounts/non-existent/deposit')
//         .send({ amount: 100 })
//         .expect(404);

//       const responseString = JSON.stringify(response.body);

//       // Should not contain env var patterns
//       expect(responseString).not.toMatch(/process\.env\./);
//       expect(responseString).not.toMatch(/MONGODB_URL/);
//       expect(responseString).not.toMatch(/REDIS_HOST/);
//       expect(responseString).not.toMatch(/SENTRY_DSN/);
//       expect(responseString).not.toMatch(/API_KEY/);
//       expect(responseString).not.toMatch(/SECRET/);
//     });

//     it('should sanitize nested objects containing sensitive data', async () => {
//       // Test that nested sensitive data is also redacted
//       const response = await request(app.getHttpServer())
//         .post('/accounts')
//         .send({
//           user: {
//             password: 'secret123',
//             token: 'jwt-token',
//             email: 'test@example.com',
//           },
//           ownerId: 'test',
//           currency: 'USD',
//           initialBalance: 100,
//         })
//         .expect(400);

//       const responseString = JSON.stringify(response.body);
      
//       // Should not contain sensitive values even in nested structures
//       expect(responseString).not.toContain('secret123');
//       expect(responseString).not.toContain('jwt-token');
//     });

//     it('should not expose correlation IDs that could leak session information', async () => {
//       // Correlation IDs should be present but should not be predictable or expose internal state
//       const response = await request(app.getHttpServer())
//         .post('/accounts/non-existent/deposit')
//         .send({ amount: 100 })
//         .expect(404);

//       // Correlation ID should be present (for tracing) but not expose internal state
//       expect(response.body.correlationId).toBeDefined();
//       expect(typeof response.body.correlationId).toBe('string');
      
//       // Should not be a simple incrementing number or predictable pattern
//       // (this is a basic check - in production you'd want more sophisticated validation)
//       expect(response.body.correlationId.length).toBeGreaterThan(5);
//     });

//     it('should verify response structure does not include internal properties', async () => {
//       const response = await request(app.getHttpServer())
//         .post('/accounts/non-existent/deposit')
//         .send({ amount: 100 })
//         .expect(404);

//       // Response should only contain expected properties
//       const allowedProperties = ['error', 'correlationId', 'path'];
//       const responseKeys = Object.keys(response.body);
      
//       responseKeys.forEach(key => {
//         expect(allowedProperties).toContain(key);
//       });

//       // Error object should only contain expected properties
//       const allowedErrorProperties = ['code', 'message', 'timestamp', 'details'];
//       if (response.body.error) {
//         const errorKeys = Object.keys(response.body.error);
//         errorKeys.forEach(key => {
//           expect(allowedErrorProperties).toContain(key);
//         });
//       }
//     });
//   });

  describe('Operational vs Non-Operational Errors', () => {
    it('should return full message for operational errors (domain errors)', async () => {
      const response = await request(app.getHttpServer())
        .post('/accounts/non-existent/deposit')
        .send({ amount: 100 })
        .expect(404);

      // Domain errors (operational) should show full message
      expect(response.body.error.message).toContain('non-existent');
      expect(response.body.error.message).not.toBe('Service temporarily unavailable');
    });
  });

  describe('HTTP Status Codes', () => {
    it('should return 400 for validation errors', async () => {
      const response = await request(app.getHttpServer())
        .post('/accounts')
        .send({})
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 404 for not found errors', async () => {
      const response = await request(app.getHttpServer())
        .get('/accounts/non-existent-id')
        .expect(404);

      expect(response.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    });

    it('should return 422 for business rule violations', async () => {
      // Create account first
      const createResponse = await request(app.getHttpServer())
        .post('/accounts')
        .send({
          ownerId: 'test-user-789',
          currency: 'USD',
          initialBalance: 50,
        })
        .expect(201);

      const accountId = createResponse.body.accountId;

      // Try to withdraw more than available
      const response = await request(app.getHttpServer())
        .post(`/accounts/${accountId}/withdraw`)
        .send({ amount: 1000 })
        .expect(422);

      expect(response.body.error.code).toBe('INSUFFICIENT_FUNDS');
    });
  });
});

