# Circuit Breaker Pattern Implementation

## Overview

The circuit breaker pattern has been implemented to handle MongoDB connection failures gracefully. This prevents cascading failures and allows the system to recover automatically when the database becomes available again.

## How It Works

### States

The circuit breaker operates in three states:

1. **CLOSED** (Normal Operation)
   - All requests pass through to MongoDB
   - Failures are counted
   - Moves to OPEN state after reaching failure threshold

2. **OPEN** (Failure Mode)
   - Requests fail immediately with `CircuitBreakerError`
   - No database calls are attempted
   - After timeout period, moves to HALF_OPEN state

3. **HALF_OPEN** (Recovery Testing)
   - Limited requests are allowed through
   - Testing if database has recovered
   - Success moves back to CLOSED
   - Failure moves back to OPEN

### Configuration

Default settings in `MongoEventStore` and `AccountsProjection`:

```typescript
{
  failureThreshold: 5,      // Open after 5 consecutive failures
  successThreshold: 2,      // Close after 2 consecutive successes
  timeout: 10000,           // Wait 10 seconds before retry
  name: 'MongoEventStore'   // For logging identification
}
```

## What Happens When DB Connection is Lost

### Before Circuit Breaker Implementation

❌ **Problems:**
- Every request attempts to connect to MongoDB
- Requests hang or timeout (30+ seconds)
- Errors cascade through the system
- No automatic recovery mechanism
- Application becomes unresponsive

### After Circuit Breaker Implementation

✅ **Improvements:**

1. **First 5 failures** (CLOSED → OPEN):
   ```
   Request 1: Tries MongoDB → Fails (count: 1/5)
   Request 2: Tries MongoDB → Fails (count: 2/5)
   Request 3: Tries MongoDB → Fails (count: 3/5)
   Request 4: Tries MongoDB → Fails (count: 4/5)
   Request 5: Tries MongoDB → Fails (count: 5/5) → Circuit OPENS
   ```

2. **Circuit OPEN** (Fast-fail mode):
   ```
   Request 6-N: Immediately fail with CircuitBreakerError
   (No database calls, instant response)
   Duration: 10 seconds
   ```

3. **After timeout** (OPEN → HALF_OPEN):
   ```
   Request N+1: Tries MongoDB (testing recovery)
   - If success (count: 1/2): Continue monitoring
   - If failure: Back to OPEN state
   ```

4. **Recovery** (HALF_OPEN → CLOSED):
   ```
   Request N+2: Tries MongoDB → Success (count: 2/2)
   Circuit CLOSES → Normal operation resumed
   ```

## Monitoring

### Check Circuit Breaker Status

```bash
curl http://localhost:3000/admin/circuit-breaker/status
```

Response:
```json
{
  "eventStore": {
    "state": "CLOSED",
    "failureCount": 0,
    "successCount": 0,
    "nextAttemptTime": 0
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

### Reset Circuit Breakers (Emergency Recovery)

```bash
curl -X POST http://localhost:3000/admin/circuit-breaker/reset
```

## Error Handling

When circuit breaker is OPEN, clients receive:

```json
{
  "statusCode": 500,
  "message": "[MongoEventStore] Circuit breaker is OPEN. Service unavailable."
}
```

This allows clients to:
- Implement retry logic with backoff
- Display appropriate error messages
- Queue operations for later retry
- Degrade functionality gracefully

## Console Logging

The circuit breaker logs state transitions:

```
[MongoEventStore] Failure detected (1/5)
[MongoEventStore] Failure detected (5/5)
[MongoEventStore] Circuit breaker OPEN - will retry in 10000ms
[MongoEventStore] Circuit breaker moving to HALF_OPEN state
[MongoEventStore] Success in HALF_OPEN (1/2)
[MongoEventStore] Success in HALF_OPEN (2/2)
[MongoEventStore] Circuit breaker CLOSED - service recovered
```

## Integration Points

### MongoEventStore
- `append()` - Protected by circuit breaker
- `load()` - Protected by circuit breaker
- `getCircuitBreakerMetrics()` - Monitor status
- `resetCircuitBreaker()` - Manual reset

### AccountsProjection
- `project()` - Protected by circuit breaker
- `getCircuitBreakerMetrics()` - Monitor status
- `resetCircuitBreaker()` - Manual reset

## Testing

### Simulate Database Failure

1. Stop MongoDB:
   ```bash
   # macOS
   brew services stop mongodb-community
   
   # Linux
   sudo systemctl stop mongod
   ```

2. Make 5 requests to trigger circuit opening:
   ```bash
   for i in {1..5}; do
     curl -X POST http://localhost:3000/accounts \
       -H "Content-Type: application/json" \
       -d '{"ownerId":"test","currency":"USD","initialBalance":100}'
   done
   ```

3. Observe circuit opens and subsequent requests fail fast

4. Restart MongoDB:
   ```bash
   brew services start mongodb-community
   ```

5. Wait 10 seconds for circuit to move to HALF_OPEN

6. Make 2 successful requests to close circuit

## Benefits

1. **Fast Failure** - Don't wait for timeouts when DB is down
2. **Resource Protection** - Stop overwhelming failed database
3. **Automatic Recovery** - Self-healing when DB comes back
4. **System Resilience** - Prevent cascading failures
5. **Observability** - Clear logging and monitoring endpoints
6. **User Experience** - Quick error responses instead of hanging

## Future Enhancements

Consider adding:
- Exponential backoff for retry timeout
- Different thresholds for different error types
- Metrics/alerts integration (Prometheus, DataDog)
- Fallback mechanisms (cached data, read-only mode)
- Per-operation circuit breakers (read vs write)
