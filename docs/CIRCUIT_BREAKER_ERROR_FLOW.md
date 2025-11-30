# Circuit Breaker Error Handling Flow

## What Happens When Circuit Breaker is OPEN?

### Complete Error Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. HTTP Request                                             │
│    POST /accounts {"ownerId":"user1","currency":"USD"}     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. AccountsController.open()                                │
│    Creates OpenAccountCommand and sends to CommandBus      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. OpenAccountHandler.execute()                             │
│    - Creates Account aggregate                              │
│    - Calls repo.save(aggregate)                             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. AccountEventRepository.save()                            │
│    - Pulls uncommitted events from aggregate                │
│    - Calls store.append(id, 'Account', version, events)    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. MongoEventStore.append()                                 │
│    - Wraps operation in circuitBreaker.execute()            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. CircuitBreaker.execute()                                 │
│    ⚠️  Circuit is OPEN!                                     │
│    - Throws: CircuitBreakerError                            │
│    - Message: "Circuit breaker is OPEN"                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. MongoEventStore.append() (catch block)                   │
│    - CircuitBreakerError propagates up                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. AccountEventRepository.save() (catch block)              │
│    - Detects CircuitBreakerError                            │
│    - Logs: "Cannot save account: Circuit breaker is OPEN"   │
│    - RESTORES uncommitted events to aggregate               │
│    - Re-throws CircuitBreakerError                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 9. OpenAccountHandler.execute() (error propagates)          │
│    - CircuitBreakerError propagates up                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 10. CommandBus.execute() (error propagates)                 │
│     - CircuitBreakerError propagates up                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 11. AccountsController.open() (error propagates)            │
│     - CircuitBreakerError propagates up                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 12. CircuitBreakerExceptionFilter (Global Filter)           │
│     - Catches CircuitBreakerError                           │
│     - Sets HTTP Status: 503 Service Unavailable             │
│     - Sets Header: Retry-After: 10                          │
│     - Returns structured error response                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 13. HTTP Response                                           │
│     Status: 503 Service Unavailable                         │
│     Headers:                                                │
│       Retry-After: 10                                       │
│     Body: {                                                 │
│       "statusCode": 503,                                    │
│       "message": "Service temporarily unavailable...",      │
│       "retryAfter": 10,                                     │
│       "details": "[MongoEventStore] Circuit breaker..."     │
│     }                                                       │
└─────────────────────────────────────────────────────────────┘
```

## Key Behaviors

### 1. Event Preservation
When circuit breaker is OPEN, the repository **restores uncommitted events** back to the aggregate:

```typescript
// Before throwing error, restore events
for (const event of events) {
  (aggregate as any).uncommittedEvents.push(event);
}
```

**Why?** 
- Events represent domain logic that was already executed
- Without restoration, they're lost forever
- Enables retry logic to work correctly

### 2. Proper HTTP Status Code

**Before:** 
- ❌ Returns 500 Internal Server Error
- ❌ Client thinks it's a bug/code error
- ❌ No guidance on when to retry

**After:**
- ✅ Returns 503 Service Unavailable
- ✅ Indicates temporary infrastructure issue
- ✅ Includes `Retry-After: 10` header

### 3. Console Logging

Circuit breaker OPEN scenario produces these logs:

```bash
# Circuit opens after failures
[MongoEventStore] Failure detected (5/5)
[MongoEventStore] Circuit breaker OPEN - will retry in 10000ms

# Request comes in
[MongoEventStore] Circuit breaker is OPEN. Service unavailable.

# Repository logs the issue
[AccountEventRepository] Cannot save account abc-123: Circuit breaker is OPEN
[AccountEventRepository] 2 uncommitted events lost
```

## Error Response Examples

### Circuit Breaker OPEN - Write Operation

```bash
POST /accounts
{
  "ownerId": "user1",
  "currency": "USD",
  "initialBalance": 100
}
```

**Response:**
```http
HTTP/1.1 503 Service Unavailable
Retry-After: 10
Content-Type: application/json

{
  "statusCode": 503,
  "timestamp": "2025-10-27T10:30:00.000Z",
  "path": "/accounts",
  "message": "Service temporarily unavailable due to database issues",
  "error": "Service Unavailable",
  "details": "[MongoEventStore] Circuit breaker is OPEN. Service unavailable.",
  "retryAfter": 10
}
```

### Circuit Breaker OPEN - Read Operation

```bash
GET /accounts/abc-123
```

**Response:**
```http
HTTP/1.1 503 Service Unavailable
Retry-After: 10
Content-Type: application/json

{
  "statusCode": 503,
  "timestamp": "2025-10-27T10:30:00.000Z",
  "path": "/accounts/abc-123",
  "message": "Service temporarily unavailable due to database issues",
  "error": "Service Unavailable",
  "details": "[MongoEventStore] Circuit breaker is OPEN. Service unavailable.",
  "retryAfter": 10
}
```

## Client-Side Handling

### Recommended Client Retry Logic

```typescript
async function createAccount(data) {
  const maxRetries = 3;
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      const response = await fetch('/accounts', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      
      if (response.status === 503) {
        // Circuit breaker is open
        const retryAfter = response.headers.get('Retry-After') || 10;
        console.log(`Service unavailable. Retrying in ${retryAfter}s...`);
        
        await sleep(retryAfter * 1000);
        attempt++;
        continue;
      }
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      return await response.json();
      
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      attempt++;
    }
  }
}
```

## State Transitions During Error

### Scenario: Create Account While Circuit is OPEN

```
Time   Request        Circuit    Action                 Result
────────────────────────────────────────────────────────────────
0s     POST /accounts OPEN       Fast-fail              503 Error
                                 No DB call             Response in <1ms
                                 Events preserved       
                                 
10s    (timeout)      HALF_OPEN  Circuit transitions    -
                                 Ready to test DB       

11s    POST /accounts HALF_OPEN  Try MongoDB            Success/Failure
                                 If success (1/2)       → Continue testing
                                 If failure             → Back to OPEN
```

## Database Consistency

### What About Uncommitted Events?

**Question:** If circuit is OPEN and we restore events to aggregate, doesn't that cause duplicate events on retry?

**Answer:** No, because:

1. **Events never reached the database** - Circuit broke before `insertMany()`
2. **Aggregate version unchanged** - No successful append happened
3. **On retry** - Same version number used, same events appended
4. **Concurrency check** - Unique index on (aggregateId, version) prevents duplicates

### Example Flow

```typescript
// First attempt (circuit OPEN)
aggregate.version = 0
uncommittedEvents = [AccountOpenedEvent]
→ Circuit throws error BEFORE database write
→ Events restored to aggregate
→ aggregate still has version 0

// Retry (circuit CLOSED)
aggregate.version = 0
uncommittedEvents = [AccountOpenedEvent] (same as before)
→ Circuit allows through
→ Successfully writes with version = 1
→ Events published
```

## Monitoring

### Check Current Status

```bash
curl http://localhost:3000/admin/circuit-breaker/status
```

```json
{
  "eventStore": {
    "state": "OPEN",
    "failureCount": 5,
    "successCount": 0,
    "nextAttemptTime": 1698409234567
  }
}
```

### Manual Recovery

If you need to force circuit closed:

```bash
curl -X POST http://localhost:3000/admin/circuit-breaker/reset
```

## Summary

When circuit breaker is OPEN:

✅ **Fast Response** - < 1ms instead of 30s timeout
✅ **Proper HTTP Status** - 503 (Service Unavailable) not 500
✅ **Retry Guidance** - `Retry-After` header tells client when
✅ **Event Safety** - Uncommitted events preserved for retry
✅ **Consistency** - No duplicate events due to version checking
✅ **Observability** - Clear logging at each layer
✅ **Auto-Recovery** - Circuit tests database after timeout

❌ **Without Circuit Breaker:**
- Requests hang for 30+ seconds
- Returns confusing 500 errors
- Events lost on retry
- System resources exhausted
- No automatic recovery
