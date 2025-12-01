# Overall Architecture Explanation

## High-Level Architecture Patterns

This application uses three core architectural patterns working together:

### 1. **CQRS (Command Query Responsibility Segregation)**
- **Commands (Writes)**: Change state, return minimal data
- **Queries (Reads)**: No state changes, return data
- **Separation**: Different models for reads and writes

### 2. **DDD (Domain-Driven Design)**
- **Domain Layer**: Business logic encapsulated in aggregates
- **Application Layer**: Orchestrates domain operations
- **Infrastructure Layer**: Technical concerns (database, messaging)

### 3. **Event Sourcing**
- **State Changes**: Stored as a sequence of events
- **Current State**: Rebuilt by replaying events
- **Complete History**: Full audit trail of all changes

---

## Architectural Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    HTTP Layer (Controllers)                 │
│  - Receives HTTP requests                                   │
│  - Validates DTOs                                           │
│  - Routes to CommandBus/QueryBus                            │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
┌───────────────┐         ┌───────────────┐
│ Command Bus  │         │  Query Bus   │
│ (Writes)     │         │  (Reads)     │
└──────┬───────┘         └──────┬───────┘
       │                        │
       ▼                        ▼
┌──────────────────┐    ┌──────────────────┐
│ Command Handlers │    │ Query Handlers   │
│ (Application)    │    │ (Application)    │
└──────┬───────────┘    └────────┬─────────┘
       │                        │
       ▼                        │
┌──────────────────┐            │
│ Domain Layer     │            │
│ - Aggregates     │            │
│ - Events         │            │
│ - Repositories   │            │
└──────┬───────────┘            │
       │                        │
       ▼                        ▼
┌──────────────────┐    ┌──────────────────┐
│ Event Store      │    │  Projections      │
│ (MongoDB)        │    │  (Read Model)     │
└──────────────────┘    └───────────────────┘
```

---

## Detailed Component Breakdown

### 1. HTTP Layer (`src/modules/accounts/http/`)

**Purpose:** Entry point for external requests

**Components:**
- `AccountsController`: REST endpoints
- `dto.ts`: Request validation

**Responsibilities:**
- Validate input
- Convert HTTP to commands/queries
- Return responses

**Example Flow:**
```typescript
POST /accounts/:id/deposit
  → Controller validates AmountDto
  → Creates DepositCommand
  → Sends to CommandBus
```

---

### 2. CQRS Buses (`src/libs/cqrs/`)

**CommandBus:**
- Routes commands to handlers
- Handles command execution
- Returns results

**QueryBus:**
- Routes queries to handlers
- Handles query execution
- Returns read data

**EventBus:**
- Publishes domain events
- Subscribes handlers to events
- Enables event-driven updates

**Registration:**
```typescript
// Handlers registered in BusWiringService.onModuleInit()
commandBus.register('DepositCommand', depositHandler);
queryBus.register('GetAccountQuery', getAccountHandler);
eventBus.subscribe('DepositedEvent', projection.project);
```

---

### 3. Application Layer (`src/modules/accounts/application/`)

**Commands:**
- `OpenAccountCommand`
- `DepositCommand`
- `WithdrawCommand`

**Queries:**
- `GetAccountQuery`

**Handlers:**
- `OpenAccountHandler`
- `DepositHandler`
- `WithdrawHandler`
- `GetAccountHandler`

**Pattern: ResilientCommandHandler**
- Base class providing:
  - Idempotency checks
  - Retry logic with exponential backoff
  - Circuit breaker integration

**Handler Flow:**
```typescript
1. Check idempotency cache
2. Load aggregate from repository
3. Execute domain logic (aggregate method)
4. Save aggregate (with retry)
5. Cache result for idempotency
```

---

### 4. Domain Layer (`src/modules/accounts/domain/`)

**Aggregates:**
- `Account`: Aggregate root
  - Encapsulates business rules
  - Manages state transitions
  - Emits domain events

**Events:**
- `AccountOpenedEvent`
- `DepositedEvent`
- `WithdrawnEvent`

**Repositories:**
- `AccountEventRepository`: Interface for persistence
  - `getById()`: Loads aggregate from events
  - `save()`: Persists new events

**Aggregate Pattern:**
```typescript
Account.open(id, ownerId, currency, balance)
  → Creates aggregate
  → Applies AccountOpenedEvent
  → Event stored in _pending array

Account.deposit(amount)
  → Validates business rules
  → Applies DepositedEvent
  → Updates internal state
  → Event stored in _pending array
```

---

### 5. Infrastructure Layer (`src/modules/accounts/infra/`)

**Event Store (`event-store.ts`):**
- `MongoEventStore`: Persists events to MongoDB
- Circuit breaker protection
- Version conflict detection
- Event loading and appending

**Projections (`projection.ts`):**
- `AccountsProjection`: Builds read model
- Listens to domain events
- Updates `accounts_read` collection
- Optimized for queries

**Bus Wiring (`bus-wiring.service.ts`):**
- Registers handlers on module init
- Subscribes event handlers
- Centralized wiring logic

---

## Complete Request Flow

### Write Flow (Command): Deposit Money

```
1. HTTP Request
   POST /accounts/abc-123/deposit
   Body: {"amount": 100}
   ↓

2. AccountsController.deposit()
   - Validates AmountDto
   - Creates DepositCommand(accountId, amount)
   - Calls commandBus.execute(command)
   ↓

3. CommandBus.execute()
   - Finds DepositHandler
   - Calls handler.execute(command)
   ↓

4. DepositHandler.execute() (ResilientCommandHandler)
   - Checks idempotency cache
   - If cached, returns cached result
   - Otherwise, calls executeInternal()
   ↓

5. DepositHandler.executeInternal()
   - Calls repo.getById(accountId)
   ↓

6. AccountEventRepository.getById()
   - Calls store.load(accountId)
   - Loads all events from MongoDB
   - Calls Account.rehydrate(events)
   - Returns Account aggregate
   ↓

7. DepositHandler.executeInternal() (continued)
   - Calls acc.deposit(amount)
   ↓

8. Account.deposit(amount)
   - Validates: amount > 0
   - Applies DepositedEvent
   - Updates _balance
   - Event stored in _pending array
   ↓

9. DepositHandler.executeInternal() (continued)
   - Calls repo.save(aggregate) [with retry]
   ↓

10. AccountEventRepository.save()
    - Pulls uncommitted events from aggregate
    - Calls store.append(aggregateId, type, version, events)
    ↓

11. MongoEventStore.append()
    - Wraps in circuit breaker
    - Inserts events into MongoDB
    - Handles version conflicts
    ↓

12. AccountEventRepository.save() (continued)
    - Publishes events to EventBus
    ↓

13. EventBus.publish(DepositedEvent)
    - Finds subscribers
    - Calls AccountsProjection.project(event)
    ↓

14. AccountsProjection.project()
    - Updates accounts_read collection
    - Increments balance
    ↓

15. DepositHandler.executeInternal() (continued)
    - Returns { accountId }
    - Caches result for idempotency
    ↓

16. Response sent to client
    { "accountId": "abc-123" }
```

### Read Flow (Query): Get Account

```
1. HTTP Request
   GET /accounts/abc-123
   ↓

2. AccountsController.get()
   - Creates GetAccountQuery(accountId)
   - Calls queryBus.execute(query)
   ↓

3. QueryBus.execute()
   - Finds GetAccountHandler
   - Calls handler.execute(query)
   ↓

4. GetAccountHandler.execute()
   - Queries accounts_read collection (projection)
   - Returns account data
   ↓

5. Response sent to client
   {
     "accountId": "abc-123",
     "ownerId": "user-1",
     "currency": "USD",
     "balance": 600
   }
```

---

## Key Design Decisions

### 1. **Custom CQRS Implementation**
- **Why**: Learning/control, no external dependency
- **Trade-off**: More code to maintain

### 2. **Event Sourcing**
- **Benefits**:
  - Complete audit trail
  - Time travel (replay events)
  - Eventual consistency support
- **Trade-offs**:
  - More complex reads (projections)
  - Event versioning needed

### 3. **Separate Read Model (Projections)**
- **Why**: Optimize queries
- **How**: `accounts_read` collection updated from events
- **Benefit**: Fast reads without replaying events

### 4. **Resilience Patterns**
- **Circuit Breaker**: Protects against DB failures
- **Retry Logic**: Handles transient failures
- **Idempotency**: Prevents duplicate processing

### 5. **NestJS Dependency Injection**
- **Why**: Testability and modularity
- **Pattern**: `@Injectable()` decorators
- **Wiring**: `BusWiringService` handles registration

---

## Data Storage

### Write Model (Event Store)
```
Collection: events
{
  _id: ObjectId,
  aggregateId: "abc-123",
  aggregateType: "Account",
  version: 1,
  type: "AccountOpenedEvent",
  payload: { accountId, ownerId, currency, balance },
  timestamp: "2024-01-15T10:00:00Z"
}
```

### Read Model (Projection)
```
Collection: accounts_read
{
  _id: ObjectId,
  accountId: "abc-123",
  ownerId: "user-1",
  currency: "USD",
  balance: 600
}
```

---

## Benefits of This Architecture

1. **Scalability**: Separate read/write models can scale independently
2. **Auditability**: Complete event history for compliance
3. **Flexibility**: Rebuild projections, add new views
4. **Resilience**: Circuit breakers, retries, idempotency
5. **Testability**: Clear separation of concerns
6. **Domain Focus**: Business logic in aggregates

---

## Trade-offs and Considerations

1. **Eventual Consistency**: Read model may lag behind writes
2. **Complexity**: More moving parts to understand
3. **Storage**: Events can grow large over time
4. **Learning Curve**: Requires understanding of patterns
5. **Performance**: Rehydration can be slow for large aggregates

---

## Summary

This is a **banking application** using:
- **CQRS** for read/write separation
- **DDD** for domain modeling
- **Event Sourcing** for persistence
- **Resilience patterns** for reliability
- **NestJS** for structure

The architecture prioritizes **scalability**, **auditability**, and **maintainability**, with trade-offs in **complexity** and **eventual consistency**.

---

## File Structure

```
src/
├── libs/
│   ├── cqrs/                    # Custom CQRS implementation
│   │   ├── command.ts
│   │   ├── command-bus.ts
│   │   ├── query.ts
│   │   ├── query-bus.ts
│   │   ├── event-bus.ts
│   │   └── aggregate-root.ts
│   └── resilience/              # Resilience patterns
│       ├── circuit-breaker.ts
│       ├── retry.ts
│       ├── idempotency-redis.ts
│       └── resilient-handler.ts
│
├── modules/
│   ├── accounts/
│   │   ├── application/         # Application layer
│   │   │   ├── commands/
│   │   │   ├── queries/
│   │   │   └── handlers/
│   │   ├── domain/              # Domain layer
│   │   │   ├── aggregates/
│   │   │   ├── events/
│   │   │   └── repositories/
│   │   ├── http/                # HTTP layer
│   │   │   ├── accounts.controller.ts
│   │   │   └── dto.ts
│   │   └── infra/               # Infrastructure layer
│   │       ├── event-store/
│   │       ├── projection/
│   │       └── bus-wiring.service.ts
│   └── admin/                   # Admin endpoints
│
└── main.ts                      # Application entry point
```

---

## Related Documentation

- `CIRCUIT_BREAKER.md` - Circuit breaker implementation details
- `DATA_LOSS_PREVENTION.md` - How data loss is prevented
- `DUPLICATE_REQUESTS.md` - Handling duplicate requests
- `RESILIENT_HANDLER_PATTERN.md` - Base handler pattern
- `RETRY_LOGIC.md` - Retry mechanism
- `REDIS_IMPLEMENTATION_SUMMARY.md` - Idempotency with Redis

