import { Test, TestingModule } from '@nestjs/testing';
import { MongoEventStore } from '../../../../src/modules/accounts/infra/event-store/event-store';
import { ConcurrencyError } from '../../../../src/libs/exceptions/domain.exceptions';
import { DB } from '../../../../src/modules/database/database.module';
import { Collection, Db } from 'mongodb';

describe('MongoEventStore - Concurrency Error Version', () => {
  let eventStore: MongoEventStore;
  let mockCollection: jest.Mocked<Collection>;
  let mockDb: jest.Mocked<Db>;

  beforeEach(async () => {
    // Create a mock cursor for find operations
    const mockCursor = {
      sort: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([]),
    };

    // Create a mock collection with proper promise-returning methods
    mockCollection = {
      insertMany: jest.fn(),
      find: jest.fn().mockReturnValue(mockCursor),
      createIndex: jest.fn().mockResolvedValue('index_name'),
    } as any;

    // Create a mock database
    mockDb = {
      collection: jest.fn().mockReturnValue(mockCollection),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MongoEventStore,
        {
          provide: DB,
          useValue: mockDb,
        },
      ],
    }).compile();

    eventStore = module.get<MongoEventStore>(MongoEventStore);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('append - Concurrency Error Version', () => {
    it('should throw ConcurrencyError with attempted version (expectedVersion + 1) on E11000 error', async () => {
      const aggregateId = 'test-account-123';
      const expectedVersion = 5; // Version before the new events
      const newEvents = [{ constructor: { name: 'DepositedEvent' }, amount: 100 }];

      // Mock MongoDB E11000 duplicate key error
      const mongoError = new Error('E11000 duplicate key error collection: test.events index: aggregateId_1_version_1 dup key: { aggregateId: "test-account-123", version: 6 }');
      mockCollection.insertMany = jest.fn().mockRejectedValue(mongoError);

      // Attempt to append - should throw ConcurrencyError with version 6 (expectedVersion + 1)
      await expect(
        eventStore.append(aggregateId, 'Account', expectedVersion, newEvents)
      ).rejects.toThrow(ConcurrencyError);

      // Verify the error has the correct version
      try {
        await eventStore.append(aggregateId, 'Account', expectedVersion, newEvents);
      } catch (error) {
        expect(error).toBeInstanceOf(ConcurrencyError);
        expect((error as ConcurrencyError).details?.expectedVersion).toBe(6); // 5 + 1
        expect((error as ConcurrencyError).details?.aggregateId).toBe(aggregateId);
      }
    });

    it('should throw ConcurrencyError with correct version for multiple events', async () => {
      const aggregateId = 'test-account-456';
      const expectedVersion = 10;
      const newEvents = [
        { constructor: { name: 'DepositedEvent' }, amount: 50 },
        { constructor: { name: 'DepositedEvent' }, amount: 25 },
      ];

      // Mock MongoDB E11000 error - conflict happens at first event (version 11)
      const mongoError = new Error('E11000 duplicate key error');
      mockCollection.insertMany = jest.fn().mockRejectedValue(mongoError);

      // Should throw with version 11 (expectedVersion + 1 for first event)
      await expect(
        eventStore.append(aggregateId, 'Account', expectedVersion, newEvents)
      ).rejects.toThrow(ConcurrencyError);

      try {
        await eventStore.append(aggregateId, 'Account', expectedVersion, newEvents);
      } catch (error) {
        expect(error).toBeInstanceOf(ConcurrencyError);
        expect((error as ConcurrencyError).details?.expectedVersion).toBe(11); // 10 + 1
      }
    });

    it('should throw ConcurrencyError with version 1 when expectedVersion is 0', async () => {
      const aggregateId = 'new-account';
      const expectedVersion = 0; // First event for a new aggregate
      const newEvents = [{ constructor: { name: 'AccountOpenedEvent' } }];

      const mongoError = new Error('E11000 duplicate key error');
      mockCollection.insertMany = jest.fn().mockRejectedValue(mongoError);

      await expect(
        eventStore.append(aggregateId, 'Account', expectedVersion, newEvents)
      ).rejects.toThrow(ConcurrencyError);

      try {
        await eventStore.append(aggregateId, 'Account', expectedVersion, newEvents);
      } catch (error) {
        expect(error).toBeInstanceOf(ConcurrencyError);
        expect((error as ConcurrencyError).details?.expectedVersion).toBe(1); // 0 + 1
      }
    });

    it('should NOT throw ConcurrencyError for non-E11000 errors', async () => {
      const aggregateId = 'test-account';
      const expectedVersion = 5;
      const newEvents = [{ constructor: { name: 'DepositedEvent' } }];

      // Mock a different MongoDB error (not E11000)
      const connectionError = new Error('ECONNREFUSED connection refused');
      mockCollection.insertMany = jest.fn().mockRejectedValue(connectionError);

      // Should throw a different error (DatabaseConnectionError via normalizeMongoError)
      await expect(
        eventStore.append(aggregateId, 'Account', expectedVersion, newEvents)
      ).rejects.toThrow();

      // But NOT a ConcurrencyError
      try {
        await eventStore.append(aggregateId, 'Account', expectedVersion, newEvents);
      } catch (error) {
        expect(error).not.toBeInstanceOf(ConcurrencyError);
      }
    });
  });
});
