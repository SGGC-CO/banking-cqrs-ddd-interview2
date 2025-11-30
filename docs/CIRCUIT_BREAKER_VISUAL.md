# Circuit Breaker Implementation - Visual Guide

## State Diagram

```
                    ┌──────────────────┐
                    │                  │
                    │     CLOSED       │
                    │  (Normal Mode)   │
                    │                  │
                    └────────┬─────────┘
                             │
                    Failures >= 5
                             │
                             ▼
                    ┌──────────────────┐
            ┌───────│                  │
            │       │       OPEN       │
            │       │  (Fast-Fail Mode)│
    Any     │       │                  │
    Failure │       └────────┬─────────┘
            │                │
            │       After 10 seconds
            │                │
            │                ▼
            │       ┌──────────────────┐
            └───────│                  │
                    │   HALF_OPEN      │
                    │ (Testing Recovery)│
                    │                  │
                    └────────┬─────────┘
                             │
                    Success >= 2
                             │
                             ▼
                    ┌──────────────────┐
                    │                  │
                    │     CLOSED       │
                    │  (Recovered!)    │
                    │                  │
                    └──────────────────┘
```

## Request Flow Example

### Scenario: MongoDB Crashes

```
Time  Request  Circuit State  Action              Result
──────────────────────────────────────────────────────────────
0s    #1       CLOSED         Try MongoDB         ❌ Timeout
                              (count: 1/5)        
1s    #2       CLOSED         Try MongoDB         ❌ Timeout
                              (count: 2/5)        
2s    #3       CLOSED         Try MongoDB         ❌ Timeout
                              (count: 3/5)        
3s    #4       CLOSED         Try MongoDB         ❌ Timeout
                              (count: 4/5)        
4s    #5       CLOSED         Try MongoDB         ❌ Timeout
                              (count: 5/5)        
                              → Circuit OPENS     
5s    #6       OPEN           Fast-fail           ❌ Immediate Error
6s    #7       OPEN           Fast-fail           ❌ Immediate Error
...
14s   #8       OPEN           Fast-fail           ❌ Immediate Error
                              (10s timeout up)    
                              → Circuit HALF_OPEN 
15s   #9       HALF_OPEN      Try MongoDB         ✅ Success!
                              (MongoDB restored)  (count: 1/2)
16s   #10      HALF_OPEN      Try MongoDB         ✅ Success!
                              → Circuit CLOSED    (count: 2/2)
17s   #11      CLOSED         Normal operation    ✅ Success!
```

## Code Integration Points

### 1. MongoEventStore.append()

```typescript
// BEFORE (No Protection)
async append(aggregateId, aggregateType, expectedVersion, newEvents) {
  // Direct MongoDB call - hangs if DB is down
  await this.events.insertMany(docs);
}

// AFTER (With Circuit Breaker)
async append(aggregateId, aggregateType, expectedVersion, newEvents) {
  return this.circuitBreaker.execute(async () => {
    // Protected MongoDB call - fails fast if DB is down
    await this.events.insertMany(docs);
  });
}
```

### 2. MongoEventStore.load()

```typescript
// BEFORE
async load(aggregateId) {
  return this.events.find({ aggregateId }).toArray();
}

// AFTER
async load(aggregateId) {
  return this.circuitBreaker.execute(async () => {
    return this.events.find({ aggregateId }).toArray();
  });
}
```

## Error Messages

### When Circuit is CLOSED (Normal)
MongoDB errors propagate normally:
```
MongoNetworkError: connection timed out
```

### When Circuit is OPEN (Protected)
Fast-fail with clear error:
```
CircuitBreakerError: [MongoEventStore] Circuit breaker is OPEN. Service unavailable.
```

## Console Output During Failure

```bash
# First failures
[MongoEventStore] Failure detected (1/5)
[MongoEventStore] Failure detected (2/5)
[MongoEventStore] Failure detected (3/5)
[MongoEventStore] Failure detected (4/5)
[MongoEventStore] Failure detected (5/5)
[MongoEventStore] Circuit breaker OPEN - will retry in 10000ms

# Fast-fail period
[MongoEventStore] Circuit breaker is OPEN. Service unavailable.
[MongoEventStore] Circuit breaker is OPEN. Service unavailable.

# Recovery testing
[MongoEventStore] Circuit breaker moving to HALF_OPEN state
[MongoEventStore] Success in HALF_OPEN (1/2)
[MongoEventStore] Success in HALF_OPEN (2/2)
[MongoEventStore] Circuit breaker CLOSED - service recovered
```

## API Endpoints

### Monitor Status
```bash
GET /admin/circuit-breaker/status

Response:
{
  "eventStore": {
    "state": "OPEN",
    "failureCount": 5,
    "successCount": 0,
    "nextAttemptTime": 1698409234567
  },
  "projection": {
    "state": "CLOSED",
    "failureCount": 0,
    "successCount": 0,
    "nextAttemptTime": 0
  },
  "timestamp": "2025-10-27T10:30:00.000Z"
}
```

### Manual Reset
```bash
POST /admin/circuit-breaker/reset

Response:
{
  "message": "Circuit breakers reset successfully",
  "timestamp": "2025-10-27T10:30:00.000Z"
}
```

## Benefits Summary

| Aspect | Before | After |
|--------|--------|-------|
| **Response Time (DB Down)** | 30+ seconds timeout | < 1ms fast-fail |
| **System Load** | High (many hanging connections) | Low (no DB calls) |
| **Recovery** | Manual restart required | Automatic after 10s |
| **User Experience** | Hanging requests | Quick error response |
| **Monitoring** | No visibility | Full metrics available |
| **Resource Usage** | Thread pool exhaustion | Protected resources |

## Configuration Options

You can adjust these values in the constructor:

```typescript
new CircuitBreaker({
  failureThreshold: 5,   // How many failures before opening
  successThreshold: 2,   // How many successes before closing
  timeout: 10000,        // Milliseconds before retry
  name: 'MyService',     // For logging
})
```

### Recommended Settings

| Environment | failureThreshold | successThreshold | timeout |
|-------------|-----------------|------------------|---------|
| Development | 3 | 1 | 5000 |
| Staging | 5 | 2 | 10000 |
| Production | 10 | 3 | 30000 |
