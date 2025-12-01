# Event Flow: HTTP Controller to Event Store

## Overview

This document describes the complete event flow from an HTTP request to event persistence and projection updates in this CQRS/DDD/Event Sourcing banking application.

---

## Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. HTTP Request                                                     │
│    POST /accounts/abc-123/deposit                                   │
│    Body: {"amount": 100}                                            │
│    Header: Idempotency-Key: "req-123" (optional)                   │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. AccountsController.deposit()                                     │
│    • Extracts accountId from URL params                            │
│    • Extracts amount from request body                              │
│    • Extracts idempotency key from headers (optional)               │
│    • Creates DepositCommand(accountId, amount, idempotencyKey)      │
│    • Sends command to CommandBus                                    │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. CommandBus.execute(DepositCommand)                               │
│    • Looks up handler by command name: "DepositCommand"             │
│    • Finds DepositHandler registered during module initialization   │
│    • Calls handler.execute(command)                                 │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. ResilientCommandHandler.execute() [Base Class]                   │
│    • Checks idempotency (if enabled)                                │
│      - Generates idempotency key from command                       │
│      - Checks cache for existing result                             │
│      - If found, returns cached result (duplicate request)          │
│    • If not cached, calls executeInternal() with retry logic        │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. DepositHandler.executeInternal()                                 │
│    • Loads Account aggregate from repository                        │
│    • Calls account.deposit(amount)                                  │
│    • Saves aggregate back to repository                             │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 6. AccountEventRepository.getById(accountId)                        │
│    • Loads stored events from event store                           │
│    • Reconstructs Account aggregate from event history              │
│    • Returns Account instance with current state                    │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 7. MongoEventStore.load(aggregateId)                                │
│    • Queries MongoDB "events" collection                            │
│    • Filters by aggregateId                                         │
│    • Sorts by version (ascending)                                   │
│    • Returns array of StoredEvent objects                           │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 8. Account.rehydrate(storedEvents)                                  │
│    • Creates new Account instance                                   │
│    • For each stored event:                                         │
│      - Reconstructs event instance from stored data                 │
│      - Calls on*Event handler (e.g., onDepositedEvent)             │
│      - Updates aggregate state                                      │
│      - Increments version                                           │
│    • Returns fully rehydrated Account with current state            │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 9. Account.deposit(amount) [Domain Logic]                           │
│    • Validates amount (must be positive)                            │
│    • Creates DepositedEvent(accountId, amount)                      │
│    • Calls aggregate.apply(event)                                   │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 10. AggregateRoot.apply(event)                                      │
│     • Calls onDepositedEvent(event) handler                         │
│       - Updates _balance += event.amount                            │
│     • Adds event to _pending array                                  │
│     • Increments version                                            │
│     • Event is now "uncommitted" (in memory only)                   │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 11. AccountEventRepository.save(account)                            │
│     • Pulls uncommitted events from aggregate                       │
│     • Attempts to append events to event store                      │
│     • If successful, publishes events to EventBus                   │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 12. AggregateRoot.pullUncommittedEvents()                           │
│     • Returns copy of _pending events array                         │
│     • Clears _pending array                                         │
│     • Events are now ready to be persisted                          │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 13. MongoEventStore.append(aggregateId, type, version, events)      │
│     • Wraps operation in CircuitBreaker.execute()                   │
│     • Transforms events into StoredEvent documents:                 │
│       {                                                              │
│         aggregateId: "abc-123",                                     │
│         aggregateType: "Account",                                   │
│         version: 5,  // Increments from expected version            │
│         type: "DepositedEvent",                                     │
│         payload: { accountId: "abc-123", amount: 100 },            │
│         timestamp: "2024-01-15T10:30:00Z"                          │
│       }                                                              │
│     • Inserts into MongoDB "events" collection                      │
│     • Unique index on (aggregateId, version) prevents duplicates   │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 14. Event Store Persistence (MongoDB)                               │
│     • Events inserted with version numbers                          │
│     • Version conflict protection via unique index                  │
│     • Events are now persisted and immutable                        │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 15. EventBus.publish(event) [Only after successful save]            │
│     • Finds subscribers for event type (e.g., "DepositedEvent")    │
│     • Calls each subscriber's handler                               │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 16. AccountsProjection.project(event)                               │
│     • Updates read model (accounts_read collection)                 │
│     • For DepositedEvent: $inc { balance: event.amount }            │
│     • For WithdrawnEvent: $inc { balance: -event.amount }           │
│     • For AccountOpenedEvent: Creates new document                  │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 17. Response Returned                                               │
│     • Handler returns { accountId: "abc-123" }                      │
│     • Idempotency result cached (if enabled)                        │
│     • Controller returns HTTP 200 with JSON response                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Step-by-Step Explanation

### Step 1-3: HTTP Request → Command Bus

**Controller:**
```typescript
@Post(":id/deposit")
async deposit(@Param("id") id: string, @Body() dto: AmountDto) {
  await this.commands.execute(new DepositCommand(id, dto.amount));
  return { accountId: id };
}
```

**CommandBus:**
```typescript
async execute(command: DepositCommand) {
  const handler = this.handlers.get("DepositCommand");
  return handler.execute(command);
}
```

### Step 4: Resilient Handler Wrapper

**Idempotency Check:**
- Generates key: `hash("deposit", accountId, amount, idempotencyKey)`
- Checks cache for existing result
- If cached, returns immediately (prevents duplicate processing)

**Retry Logic:**
- Wraps execution in retry mechanism
- Handles CircuitBreakerError with exponential backoff
- Restores events if persistence fails

### Step 5-7: Loading Aggregate

**Repository loads aggregate:**
```typescript
async getById(id: string): Promise<Account | null> {
  const events = await this.store.load(id);
  if (!events.length) return null;
  return Account.rehydrate(events);
}
```

**Event Store queries MongoDB:**
```typescript
async load(aggregateId: string) {
  return this.circuitBreaker.execute(async () => {
    const cur = this.events.find({ aggregateId }).sort({ version: 1 });
    return cur.toArray();
  });
}
```

### Step 8: Aggregate Rehydration

**Reconstructs state from events:**
```typescript
static rehydrate(storedEvents: StoredEvent[]): Account {
  const account = new Account();
  for (const storedEvent of storedEvents) {
    // Reconstruct event instance
    const event = new DepositedEvent(storedEvent.payload.accountId, storedEvent.payload.amount);
    // Apply event to aggregate
    account.onDepositedEvent(event);
    account.setVersion(account.version + 1);
  }
  return account;
}
```

### Step 9-10: Domain Logic - Event Creation

**Domain method creates event:**
```typescript
deposit(amount: number) {
  if (amount <= 0) throw new Error("Deposit amount must be positive");
  this.apply(new DepositedEvent(this.id!, amount));
}
```

**Apply method handles event:**
```typescript
protected apply(event: any) {
  // Update state
  const handler = this[`on${event.constructor.name}`];
  if (handler) handler.call(this, event);
  
  // Store in pending events
  this._pending.push(event);
  this._version += 1;
}
```

**State handler updates aggregate:**
```typescript
onDepositedEvent(e: DepositedEvent) {
  this._balance += e.amount;
}
```

### Step 11-13: Event Persistence

**Repository saves aggregate:**
```typescript
async save(aggregate: Account) {
  const events = aggregate.pullUncommittedEvents();
  
  // Persist to event store
  await this.store.append(
    aggregate.id!,
    "Account",
    aggregate.version - events.length, // Expected version
    events
  );
  
  // Publish events (only after successful persistence)
  if (this.bus && events.length) {
    for (const ev of events) await this.bus.publish(ev);
  }
}
```

**Event Store transforms and persists:**
```typescript
async append(aggregateId: string, aggregateType: string, expectedVersion: number, newEvents: any[]) {
  const docs: StoredEvent[] = newEvents.map((ev, i) => ({
    aggregateId,
    aggregateType,
    version: expectedVersion + i + 1,
    type: ev.constructor.name,  // "DepositedEvent"
    payload: ev,                 // Event data
    timestamp: new Date().toISOString(),
  }));
  
  await this.events.insertMany(docs, { ordered: true });
}
```

### Step 14: MongoDB Storage

**Event Document Structure:**
```json
{
  "_id": ObjectId("..."),
  "aggregateId": "abc-123",
  "aggregateType": "Account",
  "version": 5,
  "type": "DepositedEvent",
  "payload": {
    "accountId": "abc-123",
    "amount": 100
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Key Points:**
- Unique index on `(aggregateId, version)` prevents duplicate events
- Version conflicts detected via E11000 error
- Events are immutable once written

### Step 15-16: Event Publication & Projection

**EventBus publishes:**
```typescript
async publish(event: any) {
  const name = event.constructor.name; // "DepositedEvent"
  const list = this.handlers.get(name);
  for (const h of list) await h(event);
}
```

**Projection updates read model:**
```typescript
async project(event: any) {
  const coll = this.db.collection("accounts_read");
  if (event instanceof DepositedEvent) {
    await coll.updateOne(
      { accountId: event.accountId },
      { $inc: { balance: event.amount } }
    );
  }
}
```

---

## Key Architectural Patterns

### 1. **Command-Query Separation (CQRS)**
- Commands modify state (write model)
- Queries read from projections (read model)
- Separate optimization paths

### 2. **Event Sourcing**
- State changes stored as events
- Current state reconstructed from event history
- Complete audit trail

### 3. **Domain-Driven Design (DDD)**
- Domain logic in aggregates
- Business rules enforced at domain level
- Infrastructure concerns separated

### 4. **Resilience Patterns**
- **Circuit Breaker**: Protects against cascading failures
- **Retry Logic**: Handles transient failures
- **Idempotency**: Prevents duplicate processing

---

## Critical Points

### ✅ Event Persistence is Atomic
Events are persisted to MongoDB atomically. If any event fails, all events fail (ordered insert).

### ✅ Events Published Only After Persistence
Events are only published to EventBus **after** successful persistence. This ensures:
- No lost events if publish fails
- Read model always consistent with event store
- Ability to replay events if needed

### ✅ Version Conflict Detection
MongoDB unique index prevents:
- Concurrent modification conflicts
- Duplicate event insertion
- Lost updates

### ✅ Circuit Breaker Protection
Event store operations wrapped in circuit breaker:
- Fast-fail when database is down
- Prevents cascading failures
- Automatic recovery attempts

### ✅ Idempotency Support
- Prevents duplicate processing
- Works with retry logic
- Client-controlled via headers

---

## Error Scenarios

### Scenario 1: Circuit Breaker OPEN

```
1. Handler calls repo.save()
2. EventStore.append() throws CircuitBreakerError
3. Repository catches error
4. Restores events to aggregate (restoreUncommittedEvents)
5. Error propagates to handler
6. Retry logic attempts save again
7. Eventually succeeds or exhausts retries
```

### Scenario 2: Version Conflict

```
1. Two concurrent requests load same aggregate
2. Both apply events and increment version
3. First request persists events successfully
4. Second request attempts persist with same version
5. MongoDB unique index violation (E11000)
6. ConcurrencyError thrown
7. Client receives 409 Conflict
```

### Scenario 3: Duplicate Request

```
1. First request processes successfully
2. Result cached with idempotency key
3. Second request (same key) arrives
4. Idempotency check finds cached result
5. Returns cached result immediately
6. No duplicate processing occurs
```

---

## Summary

The event flow follows this pattern:

1. **HTTP Request** → Controller receives request
2. **Command Creation** → Controller creates command object
3. **Command Bus** → Routes command to appropriate handler
4. **Handler Execution** → Business logic executed
5. **Aggregate Loading** → Events loaded and state reconstructed
6. **Domain Logic** → Business rules applied, events created
7. **Event Persistence** → Events saved to MongoDB
8. **Event Publication** → Events published to EventBus
9. **Projection Update** → Read model updated
10. **Response** → HTTP response returned

This architecture ensures:
- ✅ **Data Integrity**: Events are source of truth
- ✅ **Resilience**: Circuit breakers and retry logic
- ✅ **Scalability**: Read/write separation
- ✅ **Auditability**: Complete event history
- ✅ **Flexibility**: Easy to add new projections

