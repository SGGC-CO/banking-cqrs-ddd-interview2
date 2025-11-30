# NestJS Dependency Injection - Violations & Fixes

## Current Problems

### ❌ Problem 1: Manual Instantiation with `useFactory`

**Current Code:**
```typescript
{
  provide: DepositHandler,
  useFactory: (repo: AccountEventRepository, idempotency: any) => 
    new DepositHandler(repo, idempotency),  // ❌ Manual new
  inject: [AccountEventRepository, IDEMPOTENCY_STORE],
}
```

**Why it's wrong:**
- Bypasses NestJS lifecycle hooks
- No automatic dependency resolution
- Can't use decorators on the class
- Hard to test and mock

---

### ❌ Problem 2: Missing `@Injectable()` Decorator

**Current Code:**
```typescript
export class DepositHandler extends ResilientCommandHandler {
  // ❌ No @Injectable() decorator
  constructor(
    private readonly repo: AccountEventRepository,
    idempotency: IdempotencyStore
  ) {
    super(idempotency);
  }
}
```

**Why it's wrong:**
- NestJS can't inject dependencies automatically
- Class isn't registered in DI container properly
- Can't be injected into other classes

---

### ❌ Problem 3: Token-based Injection Without Type Safety

**Current Code:**
```typescript
export const IDEMPOTENCY_STORE = 'IDEMPOTENCY_STORE';  // ❌ String token

{
  provide: IDEMPOTENCY_STORE,
  useFactory: (redis: any) => { ... },
  inject: [REDIS],
}
```

**Why it's problematic:**
- No TypeScript type safety
- Magic strings can have typos
- Hard to refactor
- Not discoverable with IDE

---

## Correct NestJS Implementation

### ✅ Fix 1: Add `@Injectable()` Decorators

```typescript
import { Injectable } from '@nestjs/common';

@Injectable()
export class DepositHandler extends ResilientCommandHandler {
  constructor(
    private readonly repo: AccountEventRepository,
    @Inject(IDEMPOTENCY_STORE) idempotency: IdempotencyStore
  ) {
    super(idempotency);
  }
  
  // ... rest of implementation
}
```

**Benefits:**
- ✅ NestJS handles instantiation
- ✅ Lifecycle hooks work
- ✅ Can be injected anywhere
- ✅ Better testing

---

### ✅ Fix 2: Use `useClass` Instead of `useFactory`

**Before:**
```typescript
{
  provide: MongoEventStore,
  useFactory: (db: Db) => new MongoEventStore(db),  // ❌
  inject: [DB],
}
```

**After:**
```typescript
// Just register the class
MongoEventStore,  // ✅ Let NestJS handle it

// Or if you need a token:
{
  provide: MongoEventStore,
  useClass: MongoEventStore,  // ✅ Still better than useFactory
}
```

---

### ✅ Fix 3: Use Class Tokens Instead of Strings

**Before:**
```typescript
export const IDEMPOTENCY_STORE = 'IDEMPOTENCY_STORE';  // ❌
```

**After:**
```typescript
// Create a symbol or class token
export const IDEMPOTENCY_STORE = Symbol('IDEMPOTENCY_STORE');  // ✅ Better

// Or even better - use an interface + class
export abstract class IdempotencyStore {  // ✅ Best
  abstract get(key: string): Promise<any>;
  abstract set(key: string, value: any, ttl: number): Promise<void>;
  abstract generateKey(...args: any[]): string;
}

// Then inject by class
constructor(@Inject(IdempotencyStore) private idempotency: IdempotencyStore)
```

---

### ✅ Fix 4: Let NestJS Resolve Dependencies

**Before (Manual):**
```typescript
{
  provide: DepositHandler,
  useFactory: (repo: AccountEventRepository, idempotency: any) => 
    new DepositHandler(repo, idempotency),
  inject: [AccountEventRepository, IDEMPOTENCY_STORE],
}
```

**After (Automatic):**
```typescript
@Injectable()
export class DepositHandler extends ResilientCommandHandler {
  constructor(
    private readonly repo: AccountEventRepository,
    @Inject(IDEMPOTENCY_STORE) idempotency: IdempotencyStore
  ) {
    super(idempotency);
  }
}

// In module:
providers: [
  DepositHandler,  // ✅ That's it! NestJS does the rest
]
```

---

## Complete Refactored Module

```typescript
import { Module, Injectable, Inject } from '@nestjs/common';

// Define abstract class for type-safe injection
@Injectable()
export abstract class IdempotencyStoreToken {
  abstract get(key: string): Promise<any>;
  abstract set(key: string, value: any, ttl: number): Promise<void>;
  abstract generateKey(...args: any[]): string;
}

@Module({
  providers: [
    // ✅ Services as simple providers
    CommandBus,
    QueryBus,
    EventBus,
    
    // ✅ Redis with proper async provider
    {
      provide: 'REDIS',
      useFactory: async () => {
        try {
          const { default: Redis } = await import('ioredis');
          const redis = new Redis({ ... });
          await redis.ping();
          return redis;
        } catch {
          return null;
        }
      },
    },
    
    // ✅ Idempotency store with interface token
    {
      provide: IdempotencyStoreToken,
      useFactory: (redis: any) => {
        return redis 
          ? new RedisIdempotencyStore(redis)
          : new InMemoryIdempotencyStore();
      },
      inject: ['REDIS'],
    },
    
    // ✅ Let NestJS handle these automatically
    MongoEventStore,
    AccountsProjection,
    AccountEventRepository,
    OpenAccountHandler,
    DepositHandler,
    WithdrawHandler,
    GetAccountHandler,
    
    // ✅ Initialization hook
    {
      provide: 'INIT',
      useFactory: (
        commandBus: CommandBus,
        queryBus: QueryBus,
        eventBus: EventBus,
        handlers: {
          open: OpenAccountHandler,
          deposit: DepositHandler,
          withdraw: WithdrawHandler,
          getAcc: GetAccountHandler,
        },
        projection: AccountsProjection
      ) => {
        // Wire up buses
        commandBus.register('OpenAccountCommand', handlers.open);
        // ... etc
        return true;
      },
      inject: [
        CommandBus,
        QueryBus,
        EventBus,
        OpenAccountHandler,
        DepositHandler,
        WithdrawHandler,
        GetAccountHandler,
        AccountsProjection,
      ],
    },
  ],
})
export class AccountsModule {}
```

---

## Comparison

| Aspect | Current (Wrong) | Proper NestJS |
|--------|----------------|---------------|
| **Instantiation** | Manual `new` | Automatic |
| **Decorators** | Missing `@Injectable()` | Has `@Injectable()` |
| **Lifecycle** | Bypassed | Hooks work |
| **Type Safety** | `any` types | Strong typing |
| **Testability** | Hard to mock | Easy to mock |
| **DI Container** | Partial use | Full use |
| **Best Practices** | ❌ Violated | ✅ Followed |

---

## Testing Impact

### Current (Manual DI)
```typescript
// ❌ Hard to test - need to manually create everything
const mockRepo = { ... };
const mockIdempotency = { ... };
const handler = new DepositHandler(mockRepo, mockIdempotency);
```

### Proper NestJS
```typescript
// ✅ Easy to test with NestJS testing utilities
const module = await Test.createTestingModule({
  providers: [
    DepositHandler,
    {
      provide: AccountEventRepository,
      useValue: mockRepo,
    },
    {
      provide: IdempotencyStoreToken,
      useValue: mockIdempotency,
    },
  ],
}).compile();

const handler = module.get(DepositHandler);
```

---

## When `useFactory` IS Appropriate

### ✅ Good Use Cases:

1. **Async initialization:**
```typescript
{
  provide: DatabaseConnection,
  useFactory: async () => {
    const connection = await connect();  // Async operation
    return connection;
  },
}
```

2. **Conditional logic:**
```typescript
{
  provide: CacheService,
  useFactory: (config: ConfigService) => {
    return config.get('USE_REDIS')
      ? new RedisCacheService()
      : new InMemoryCacheService();
  },
  inject: [ConfigService],
}
```

3. **External library wrapping:**
```typescript
{
  provide: Logger,
  useFactory: () => {
    return winston.createLogger({ ... });  // External library
  },
}
```

### ❌ Bad Use Cases:

1. **Simple class instantiation:**
```typescript
// ❌ DON'T DO THIS
{
  provide: UserService,
  useFactory: (repo: UserRepository) => new UserService(repo),
  inject: [UserRepository],
}

// ✅ DO THIS INSTEAD
@Injectable()
class UserService {
  constructor(private repo: UserRepository) {}
}

providers: [UserService]  // That's it!
```

---

## Summary

### Current Implementation Issues:

1. ❌ Manual `new` instantiation everywhere
2. ❌ Missing `@Injectable()` decorators
3. ❌ Overuse of `useFactory` for simple cases
4. ❌ String-based tokens (not type-safe)
5. ❌ Bypassing NestJS DI container benefits

### Recommendation:

**Refactor to use proper NestJS DI:**
- Add `@Injectable()` to all services
- Remove unnecessary `useFactory` providers
- Use `@Inject()` decorator for custom tokens
- Let NestJS handle instantiation
- Use class tokens for type safety

**Priority: HIGH** - This is a fundamental architecture issue that affects:
- Testability
- Maintainability  
- Type safety
- NestJS ecosystem compatibility
