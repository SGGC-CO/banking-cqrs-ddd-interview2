# NestJS Dependency Injection Refactoring

## Summary

Refactored the entire codebase to follow NestJS dependency injection best practices by:
1. Adding `@Injectable()` decorators to all service classes
2. Removing unnecessary `useFactory` providers
3. Creating a proper `BusWiringService` with lifecycle hooks
4. Letting NestJS handle automatic dependency resolution

---

## Classes Updated with @Injectable()

### CQRS Infrastructure
- ✅ `CommandBus` - src/libs/cqrs/command-bus.ts
- ✅ `QueryBus` - src/libs/cqrs/query-bus.ts
- ✅ `EventBus` - src/libs/cqrs/event-bus.ts

### Command Handlers
- ✅ `OpenAccountHandler` - src/modules/accounts/application/handlers/open-account.handler.ts
- ✅ `DepositHandler` - src/modules/accounts/application/handlers/deposit.handler.ts
- ✅ `WithdrawHandler` - src/modules/accounts/application/handlers/withdraw.handler.ts

### Query Handlers
- ✅ `GetAccountHandler` - src/modules/accounts/application/handlers/get-account.handler.ts

### Infrastructure
- ✅ `MongoEventStore` - src/modules/accounts/infra/event-store/event-store.ts
- ✅ `AccountsProjection` - src/modules/accounts/infra/projection/accounts.projection.ts
- ✅ `AccountEventRepository` - src/modules/accounts/domain/repositories/account-event.repository.ts
- ✅ `BusWiringService` - src/modules/accounts/infra/bus-wiring.service.ts (NEW)

---

## Before vs After: accounts.module.ts

### ❌ BEFORE (Manual Instantiation)
```typescript
{
  provide: DepositHandler,
  useFactory: (repo: AccountEventRepository, idempotency: any) => 
    new DepositHandler(repo, idempotency),
  inject: [AccountEventRepository, IDEMPOTENCY_STORE],
}
```

**Problems:**
- Manual `new` operator bypasses DI container
- Cannot be easily mocked in tests
- Verbose and repetitive
- 80+ lines of boilerplate

### ✅ AFTER (Automatic Injection)
```typescript
DepositHandler,  // That's it! NestJS handles the rest
```

**Benefits:**
- NestJS automatically resolves dependencies
- Fully testable with DI mocking
- Clean and concise
- ~15 lines total

---

## Key Changes

### 1. BusWiringService (NEW)
**File:** `src/modules/accounts/infra/bus-wiring.service.ts`

```typescript
@Injectable()
export class BusWiringService implements OnModuleInit {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly eventBus: EventBus,
    private readonly openAccountHandler: OpenAccountHandler,
    private readonly depositHandler: DepositHandler,
    private readonly withdrawHandler: WithdrawHandler,
    private readonly getAccountHandler: GetAccountHandler,
    private readonly accountsProjection: AccountsProjection,
  ) {}

  onModuleInit() {
    // Register all handlers when module initializes
    this.commandBus.register('OpenAccountCommand', this.openAccountHandler);
    this.commandBus.register('DepositCommand', this.depositHandler);
    this.commandBus.register('WithdrawCommand', this.withdrawHandler);
    this.queryBus.register('GetAccountQuery', this.getAccountHandler);
    
    this.eventBus.subscribe('AccountOpenedEvent', (e) => this.accountsProjection.project(e));
    this.eventBus.subscribe('DepositedEvent', (e) => this.accountsProjection.project(e));
    this.eventBus.subscribe('WithdrawnEvent', (e) => this.accountsProjection.project(e));
  }
}
```

**Why this is better:**
- Uses `OnModuleInit` lifecycle hook (proper NestJS pattern)
- Constructor injection ensures type safety
- Easily testable with mocks
- Clear separation of concerns

### 2. Simplified Module Providers

**Before:** 80+ lines of useFactory boilerplate
**After:** Clean list of injectable classes

```typescript
providers: [
  // CQRS Buses - simple @Injectable classes
  CommandBus,
  QueryBus,
  EventBus,
  
  // Redis & Idempotency (useFactory IS appropriate here - conditional logic)
  { provide: REDIS, useFactory: async () => { /* async Redis setup */ } },
  { provide: IDEMPOTENCY_STORE, useFactory: (redis) => { /* conditional */ }, inject: [REDIS] },
  
  // Infrastructure - NestJS handles instantiation
  MongoEventStore,
  AccountsProjection,
  AccountEventRepository,
  
  // Handlers - automatic dependency resolution
  OpenAccountHandler,
  DepositHandler,
  WithdrawHandler,
  GetAccountHandler,
  
  // Wiring
  BusWiringService,
]
```

---

## When to Use useFactory (Still Valid)

### ✅ Appropriate Uses
1. **Async initialization** - Redis connection with dynamic import
2. **Conditional logic** - Choose IdempotencyStore based on Redis availability
3. **External values** - Injecting `DB` from app.module

### ❌ Avoid For
- Simple class instantiation
- Classes with `@Injectable()` decorator
- Services that only need other services injected

---

## Testing Benefits

### Before
```typescript
// Hard to mock - manual instantiation
const handler = new DepositHandler(mockRepo, mockIdempotency);
```

### After
```typescript
// Easy to mock with NestJS testing utilities
const module = await Test.createTestingModule({
  providers: [
    DepositHandler,
    { provide: AccountEventRepository, useValue: mockRepo },
    { provide: IDEMPOTENCY_STORE, useValue: mockIdempotency },
  ],
}).compile();

const handler = module.get<DepositHandler>(DepositHandler);
```

---

## Dependency Graph

```
BusWiringService
├── CommandBus
├── QueryBus
├── EventBus
├── OpenAccountHandler
│   └── AccountEventRepository
│       ├── MongoEventStore (requires DB)
│       └── EventBus
├── DepositHandler
│   ├── AccountEventRepository
│   └── IDEMPOTENCY_STORE
├── WithdrawHandler
│   ├── AccountEventRepository
│   └── IDEMPOTENCY_STORE
├── GetAccountHandler (requires DB)
└── AccountsProjection (requires DB)
```

**NestJS automatically resolves this entire graph!**

---

## Migration Checklist

- [x] Add `@Injectable()` to all CQRS buses
- [x] Add `@Injectable()` to all handlers
- [x] Add `@Injectable()` to all infrastructure classes
- [x] Create `BusWiringService` with `OnModuleInit`
- [x] Remove manual `useFactory` for simple classes
- [x] Keep `useFactory` for conditional/async initialization
- [x] Update module providers to use class references
- [x] Verify dependency graph resolves correctly

---

## Result

**Code Reduction:**
- Before: ~150 lines in accounts.module.ts
- After: ~60 lines in accounts.module.ts
- **Savings: 60% less boilerplate**

**Improvements:**
- ✅ Follows NestJS best practices
- ✅ Type-safe dependency injection
- ✅ Easily testable with DI mocking
- ✅ Clear separation of concerns
- ✅ Automatic dependency resolution
- ✅ Proper lifecycle management

**Violations Fixed:**
- ❌ Manual `new` instantiation → ✅ DI container
- ❌ Missing `@Injectable()` → ✅ All classes decorated
- ❌ Overuse of `useFactory` → ✅ Only where needed
- ❌ String tokens everywhere → ✅ Class references (mostly)
