# Quick Reference: Circuit Breaker Error Handling

## What Happens When Circuit is OPEN?

### 🔴 Immediate Effects

```
Request → Circuit Breaker (OPEN) → Throws CircuitBreakerError
                                    ↓
                         Response < 1ms (fast-fail)
```

### 📊 Complete Flow

```
┌─────────────────────────────────────────────────────────┐
│ Client Request                                          │
│ POST /accounts                                          │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ Controller → CommandBus → Handler                       │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ Repository.save()                                       │
│ • Pulls events: [AccountOpenedEvent]                    │
│ • Calls: store.append()                                 │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ MongoEventStore.append()                                │
│ • Wraps in: circuitBreaker.execute()                    │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ ⚠️  CircuitBreaker (OPEN)                               │
│ • Throws: CircuitBreakerError                           │
│ • No MongoDB call made                                  │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ Repository.save() catch block                           │
│ • Detects: CircuitBreakerError                          │
│ • Action: Restores events to aggregate._pending         │
│ • Logs: "Circuit breaker is OPEN"                       │
│ • Re-throws: CircuitBreakerError                        │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ Error propagates up the stack                           │
│ Handler → CommandBus → Controller                       │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ CircuitBreakerExceptionFilter                           │
│ • Catches: CircuitBreakerError                          │
│ • Sets: HTTP 503 Status                                 │
│ • Adds: Retry-After: 10 header                          │
│ • Returns: Structured error response                    │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ HTTP Response (503 Service Unavailable)                 │
│                                                          │
│ {                                                        │
│   "statusCode": 503,                                    │
│   "message": "Service temporarily unavailable...",      │
│   "retryAfter": 10                                      │
│ }                                                        │
└──────────────────────────────────────────────────────────┘
```

## Key Points

### ✅ Events Are Safe
- Events pulled from aggregate before save attempt
- When circuit is OPEN, events **restored** to `aggregate._pending`
- Aggregate version **unchanged** (no successful write)
- On retry, same events sent with same version
- Unique index prevents duplicates

### ✅ Fast Failure
- Circuit breaker checks state **before** calling MongoDB
- OPEN state = immediate error (< 1ms)
- No waiting for timeouts
- System resources protected

### ✅ Proper HTTP Response
- **503** Service Unavailable (not 500)
- **Retry-After: 10** header
- Clear error message
- Structured response

### ✅ Observability
```
[MongoEventStore] Circuit breaker is OPEN. Service unavailable.
[AccountEventRepository] Cannot save account abc-123: Circuit breaker is OPEN
[AccountEventRepository] 1 uncommitted event(s) not persisted
```

## Error Response Example

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

## Timeline

```
0s  - MongoDB crashes
1s  - Request #1 fails (count 1/5)
2s  - Request #2 fails (count 2/5)
3s  - Request #3 fails (count 3/5)
4s  - Request #4 fails (count 4/5)
5s  - Request #5 fails (count 5/5) → Circuit OPENS
6s  - Request #6: 503 response in <1ms ✅
7s  - Request #7: 503 response in <1ms ✅
15s - Circuit moves to HALF_OPEN (timeout expired)
16s - Request #8 tries MongoDB
      → Success? (count 1/2) → Continue testing
      → Failure? → Back to OPEN
17s - Request #9 tries MongoDB
      → Success? (count 2/2) → Circuit CLOSED ✅
```

## Data Consistency Guarantee

### Question: What if we retry after circuit is OPEN?

```typescript
// First attempt (circuit OPEN)
aggregate.version = 0
events = [AccountOpenedEvent]
↓
Circuit throws BEFORE database write
Events restored to aggregate._pending
aggregate.version still = 0
↓
// Retry attempt (circuit CLOSED)
aggregate.version = 0
events = [AccountOpenedEvent] (same events)
↓
Successfully writes to MongoDB with version = 1
↓
MongoDB unique index on (aggregateId, version) prevents duplicates
```

**Result:** No duplicate events, guaranteed consistency! ✅

## Monitoring Endpoints

```bash
# Check circuit status
GET /admin/circuit-breaker/status

# Manual reset (emergency)
POST /admin/circuit-breaker/reset
```

## Files Modified

1. **Circuit Breaker Core**
   - `src/libs/resilience/circuit-breaker.ts`
   
2. **Exception Filter**
   - `src/libs/resilience/circuit-breaker.filter.ts`
   - Registered in `src/main.ts`

3. **Repository Protection**
   - `src/modules/accounts/domain/repositories/account-event.repository.ts`
   - Event restoration logic
   
4. **Infrastructure Protection**
   - `src/modules/accounts/infra/event-store/event-store.ts`
   - `src/modules/accounts/infra/projection/accounts.projection.ts`
