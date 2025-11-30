# Retry Logic Implementation - Preventing Data Loss

## Overview

When the circuit breaker is OPEN and throws `CircuitBreakerError`, the repository restores uncommitted events to the aggregate. To ensure these events are eventually persisted, we need **retry logic at the handler level**.

## Why Handler Level?

### ❌ Wrong Places for Retry Logic

1. **Repository Level**
   ```typescript
   // DON'T DO THIS - Repository shouldn't know about retries
   async save(aggregate: Account) {
     for (let i = 0; i < 3; i++) {
       try {
         await this.store.append(...);
         return;
       } catch (error) {
         if (i === 2) throw error;
       }
     }
   }
   ```
   **Problem:** Repository is infrastructure, should be simple

2. **Controller Level**
   ```typescript
   // DON'T DO THIS - Controller shouldn't retry business logic
   @Post()
   async open(@Body() dto: OpenAccountDto) {
     for (let i = 0; i < 3; i++) {
       try {
         await this.commands.execute(...);
         return;
       } catch (error) { ... }
     }
   }
   ```
   **Problem:** Mixing HTTP concerns with business logic retry

### ✅ Correct Place: Handler Level

```typescript
export class OpenAccountHandler {
  async execute(cmd: OpenAccountCommand) {
    const agg = Account.open(...);
    
    // Retry at handler level - business logic layer
    await retry(
      () => this.repo.save(agg),
      {
        maxAttempts: 3,
        delayMs: 2000,
        backoffMultiplier: 2,
        retryableErrors: [CircuitBreakerError],
      }
    );
  }
}
```

**Why this works:**
- Handler is the application/business layer
- Aggregate keeps events between retries via `restoreUncommittedEvents()`
- Separation of concerns maintained
- Configurable per use case

## Complete Flow with Retry

### Scenario: Circuit Opens During Save

```
┌─────────────────────────────────────────────────────────────┐
│ 1. HTTP Request: POST /accounts                             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. OpenAccountHandler.execute()                             │
│    - Creates aggregate                                      │
│    - Aggregate has: [AccountOpenedEvent]                    │
│    - Version: 0 → 1                                         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. ATTEMPT 1: retry(() => repo.save(agg))                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. repo.save(agg)                                           │
│    - Pulls events: [AccountOpenedEvent]                     │
│    - Calls store.append()                                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. CircuitBreaker (OPEN)                                    │
│    - Throws CircuitBreakerError                             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. repo.save() catch block                                  │
│    - Detects CircuitBreakerError                            │
│    - Calls: agg.restoreUncommittedEvents([event])           │
│    - Aggregate now has events back!                         │
│    - Version: 1 → 0 (restored)                              │
│    - Re-throws error                                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. retry() catches CircuitBreakerError                      │
│    - Logs: "Attempt 1/3 failed"                             │
│    - Waits 2 seconds                                        │
│    - Aggregate STILL HAS the events!                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. ATTEMPT 2: retry(() => repo.save(agg))                   │
│    - Circuit might be HALF_OPEN now (after 10s timeout)     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 9. repo.save(agg) - SECOND ATTEMPT                          │
│    - Pulls SAME events again: [AccountOpenedEvent]          │
│    - Calls store.append() with version = 0                  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 10. CircuitBreaker (HALF_OPEN)                              │
│     - Allows request through                                │
│     - MongoDB SUCCESS!                                      │
│     - Events persisted with version = 1                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 11. Events published to EventBus                            │
│     - Projection updated                                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 12. Handler returns success                                 │
│     { accountId: "abc-123" }                                │
└─────────────────────────────────────────────────────────────┘
```

## Key Points

### 1. Aggregate Keeps Events Between Retries

```typescript
// After first failed attempt
aggregate._pending = [AccountOpenedEvent]  // Restored!
aggregate.version = 0                       // Restored!

// Second attempt uses same state
repo.save(agg) // Will pull the same events again
```

### 2. No Duplicate Events

```typescript
// First attempt: version = 0, event version will be 1
// FAILED - not written to DB

// Second attempt: version = 0, event version will be 1 (same!)
// SUCCESS - written to DB

// MongoDB unique index on (aggregateId, version) prevents duplicates
```

### 3. Exponential Backoff

```
Attempt 1: Immediate
↓ FAIL
Wait 2 seconds
↓
Attempt 2: After 2s
↓ FAIL
Wait 4 seconds (2s × 2)
↓
Attempt 3: After 4s more
↓ FAIL
Give up, throw error to client
```

## Configuration Options

### Aggressive Retry (Write-Critical Operations)

```typescript
await retry(
  () => this.repo.save(agg),
  {
    maxAttempts: 5,      // Try 5 times
    delayMs: 1000,       // Start with 1s
    backoffMultiplier: 2, // 1s, 2s, 4s, 8s, 16s
    retryableErrors: [CircuitBreakerError],
  }
);
```

### Conservative Retry (Read Operations)

```typescript
await retry(
  () => this.repo.getById(id),
  {
    maxAttempts: 2,      // Only 2 attempts
    delayMs: 5000,       // Wait 5s
    backoffMultiplier: 1, // Fixed delay
    retryableErrors: [CircuitBreakerError],
  }
);
```

### No Retry (Fire and Forget)

```typescript
// For non-critical operations, just let it fail
try {
  await this.repo.save(agg);
} catch (error) {
  if (error instanceof CircuitBreakerError) {
    // Log and move on
    console.warn('Failed to save, will retry later');
    return;
  }
  throw error;
}
```

## Console Output Example

### Successful Retry After Circuit Opens

```bash
# First attempt fails
[MongoEventStore] Circuit breaker is OPEN. Service unavailable.
[AccountEventRepository] Cannot save account abc-123: Circuit breaker is OPEN
[AccountEventRepository] 1 uncommitted event(s) not persisted
[Retry] Attempt 1/3 failed: [MongoEventStore] Circuit breaker is OPEN. Service unavailable.
[Retry] Waiting 2000ms before retry...

# Circuit moves to HALF_OPEN after timeout
[MongoEventStore] Circuit breaker moving to HALF_OPEN state

# Second attempt succeeds
[MongoEventStore] Success in HALF_OPEN (1/2)
# Events saved successfully
```

### All Retries Exhausted

```bash
[Retry] Attempt 1/3 failed: Circuit breaker is OPEN
[Retry] Waiting 2000ms before retry...
[Retry] Attempt 2/3 failed: Circuit breaker is OPEN
[Retry] Waiting 4000ms before retry...
[Retry] Attempt 3/3 failed: Circuit breaker is OPEN
# Error propagates to client as 503 Service Unavailable
```

## Alternative: Message Queue for Guaranteed Delivery

For critical operations that MUST succeed eventually:

```typescript
export class OpenAccountHandler {
  async execute(cmd: OpenAccountCommand) {
    const agg = Account.open(...);
    
    try {
      await retry(() => this.repo.save(agg), {...});
    } catch (error) {
      if (error instanceof CircuitBreakerError) {
        // All retries failed, queue for later processing
        await this.messageQueue.enqueue({
          type: 'PERSIST_AGGREGATE',
          aggregateId: agg.id,
          events: agg.pullUncommittedEvents(),
          version: agg.version,
        });
        
        // Return partial success to user
        return {
          accountId: cmd.accountId,
          status: 'queued',
          message: 'Account created, pending persistence'
        };
      }
      throw error;
    }
  }
}
```

## Testing the Retry Logic

```bash
# 1. Stop MongoDB
brew services stop mongodb-community

# 2. Make a request (will retry 3 times over ~14 seconds)
time curl -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"ownerId":"test","currency":"USD","initialBalance":100}'

# 3. During retry window, start MongoDB
brew services start mongodb-community

# 4. Watch it succeed on retry!
```

## Summary

**Where to put retry logic:** ✅ **Handler Level (Application Layer)**

**Why it works:**
1. Events restored to aggregate after circuit breaker error
2. Aggregate maintains state between retries
3. Same events attempted with same version
4. MongoDB unique index prevents duplicates
5. Eventually succeeds when circuit closes

**No data loss because:**
- `restoreUncommittedEvents()` keeps events in aggregate
- Retry logic in handler attempts save again
- Events only cleared after successful persistence
- Version control prevents duplicates
