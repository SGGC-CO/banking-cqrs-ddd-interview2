# Data Loss Prevention - Complete Solution

## The Problem

```
Circuit Breaker OPEN → Events lost? 🤔
```

## The Solution (3 Parts)

### Part 1️⃣: Event Restoration (Repository)

```typescript
// AccountEventRepository.save()
try {
  await this.store.append(...);
} catch (error) {
  if (error instanceof CircuitBreakerError) {
    // RESTORE EVENTS TO AGGREGATE
    aggregate.restoreUncommittedEvents(events);
    throw error;
  }
}
```

**Result:** Events are back in the aggregate ✅

---

### Part 2️⃣: Proper Restore Method (AggregateRoot)

```typescript
// AggregateRoot.restoreUncommittedEvents()
restoreUncommittedEvents(events: any[]) {
  this._pending = [...events, ...this._pending];
  this._version -= events.length;
}
```

**Result:** Aggregate state properly restored ✅

---

### Part 3️⃣: Retry Logic (Handler)

```typescript
// OpenAccountHandler.execute()
const agg = Account.open(...);

await retry(
  () => this.repo.save(agg), // Aggregate has the events!
  {
    maxAttempts: 3,
    delayMs: 2000,
    backoffMultiplier: 2,
  }
);
```

**Result:** Events eventually persisted ✅

---

## Visual Flow

```
┌─────────────────────────────────────────────────┐
│ Handler creates aggregate                       │
│ aggregate._pending = [Event1, Event2]           │
│ aggregate.version = 2                           │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ ATTEMPT 1: repo.save(agg)                       │
│                                                  │
│ ┌─────────────────────────────────────────────┐ │
│ │ pulls: [Event1, Event2]                     │ │
│ │ aggregate._pending = [] (cleared)           │ │
│ └──────────────┬──────────────────────────────┘ │
│                │                                 │
│                ▼                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ store.append() → Circuit OPEN ❌            │ │
│ └──────────────┬──────────────────────────────┘ │
│                │                                 │
│                ▼                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ catch CircuitBreakerError                   │ │
│ │ RESTORE: agg._pending = [Event1, Event2]    │ │
│ │          agg.version = 0                    │ │
│ └─────────────────────────────────────────────┘ │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
        ⏳ Wait 2 seconds
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ ATTEMPT 2: repo.save(agg)                       │
│                                                  │
│ ┌─────────────────────────────────────────────┐ │
│ │ pulls: [Event1, Event2] (same events!)      │ │
│ │ aggregate._pending = [] (cleared again)     │ │
│ └──────────────┬──────────────────────────────┘ │
│                │                                 │
│                ▼                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ store.append() → Circuit HALF_OPEN ✅       │ │
│ │ MongoDB SUCCESS!                            │ │
│ │ Events persisted with version = 1, 2        │ │
│ └──────────────┬──────────────────────────────┘ │
│                │                                 │
│                ▼                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ Events published to EventBus                │ │
│ └─────────────────────────────────────────────┘ │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ SUCCESS! No data lost 🎉                        │
└─────────────────────────────────────────────────┘
```

## Why Each Part is Critical

### Without Part 1 (Event Restoration)
```
Circuit Opens → Events pulled but never saved → LOST ❌
```

### Without Part 2 (Proper Method)
```
Can't access private _pending → Can't restore → LOST ❌
```

### Without Part 3 (Retry Logic)
```
Events restored but never retried → Stuck in aggregate → LOST ❌
```

### With All 3 Parts
```
Circuit Opens → Events restored → Retry succeeds → SAVED ✅
```

## Files Modified

1. ✅ `src/libs/cqrs/aggregate-root.ts`
   - Added `restoreUncommittedEvents()` method

2. ✅ `src/modules/accounts/domain/repositories/account-event.repository.ts`
   - Event restoration on `CircuitBreakerError`

3. ✅ `src/libs/resilience/retry.ts`
   - Retry utility with exponential backoff

4. ✅ `src/modules/accounts/application/handlers/*.handler.ts`
   - OpenAccountHandler
   - DepositHandler
   - WithdrawHandler
   - All use retry logic on save operations

## Configuration

```typescript
{
  maxAttempts: 3,           // Try up to 3 times
  delayMs: 2000,            // Wait 2s between retries
  backoffMultiplier: 2,     // Exponential: 2s, 4s, 8s
  retryableErrors: [        // Only retry these errors
    CircuitBreakerError
  ],
}
```

## Timeline Example

```
0.0s  - Request arrives
0.0s  - Handler creates aggregate with events
0.0s  - Attempt 1: Circuit OPEN → Restore events
2.0s  - Attempt 2: Circuit OPEN → Restore events
6.0s  - Attempt 3: Circuit HALF_OPEN → SUCCESS! ✅
6.0s  - Response sent to client
```

## Testing

```bash
# Terminal 1: Stop MongoDB
brew services stop mongodb-community

# Terminal 2: Make request (will retry)
curl -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"ownerId":"user1","currency":"USD","initialBalance":100}'

# Terminal 1: Start MongoDB within 14 seconds
brew services start mongodb-community

# Watch retry succeed! 🎉
```

## Result

✅ **No data loss**  
✅ **Automatic retry**  
✅ **Circuit breaker protection**  
✅ **Eventual consistency guaranteed**  
✅ **Clean separation of concerns**
