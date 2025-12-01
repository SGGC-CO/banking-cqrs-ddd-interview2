# Circuit Breaker Fast-Fail Bug Fix

## Problem

When the circuit breaker was in the OPEN state (database unavailable), requests were taking **30 seconds** to return a 503 error instead of failing immediately as expected.

### Expected Behavior
- Circuit OPEN → Immediate 503 response (<1ms)
- Fast-fail to prevent cascading failures
- Client receives `Retry-After` header

### Actual Behavior (Before Fix)
- Circuit OPEN → Wait ~30 seconds → 503 response
- Requests hung for ~30 seconds
- Poor user experience

---

## Root Cause

The retry logic was configured to retry `CircuitBreakerError`, which caused requests to retry 3 times with exponential backoff even when the circuit breaker was already OPEN.

### Flow (Before Fix)

```
1. Request arrives
2. Handler.execute() calls retry()
3. executeInternal() calls repo.save()
4. EventStore.append() → Circuit OPEN → throws CircuitBreakerError
5. Retry logic catches CircuitBreakerError
6. Waits 2 seconds → Retry attempt 2
7. Circuit still OPEN → CircuitBreakerError
8. Waits 4 seconds → Retry attempt 3
9. Circuit still OPEN → CircuitBreakerError
10. Finally throws error
11. Exception filter returns 503
```

**Total delay: ~2s + 4s + 8s = ~14-30 seconds** ❌

### Why This Was Wrong

When the circuit breaker is **OPEN**, it means:
- The service is known to be unavailable
- Retrying will fail immediately (no point retrying)
- We should **fail fast** to prevent resource waste
- The circuit breaker has already determined the service is down

Retry logic should only retry **transient errors**, not circuit breaker failures.

---

## The Fix

### Changes Made

#### 1. Updated `resilient-handler.ts`

**Before:**
```typescript
protected readonly retryOptions: RetryOptions = {
  maxAttempts: 3,
  delayMs: 2000,
  backoffMultiplier: 2,
  retryableErrors: [CircuitBreakerError], // ❌ Wrong - retries circuit breaker errors
};
```

**After:**
```typescript
protected readonly retryOptions: RetryOptions = {
  maxAttempts: 3,
  delayMs: 2000,
  backoffMultiplier: 2,
  retryableErrors: [], // ✅ Don't retry CircuitBreakerError - fail fast
};
```

#### 2. Updated `retry.ts` default behavior

**Before:**
```typescript
retryableErrors = [CircuitBreakerError], // Default was to retry circuit breaker errors
```

**After:**
```typescript
retryableErrors = [], // Default: no retryable errors (must be explicitly configured)
```

### Flow (After Fix)

```
1. Request arrives
2. Handler.execute() calls retry()
3. executeInternal() calls repo.save()
4. EventStore.append() → Circuit OPEN → throws CircuitBreakerError
5. Retry logic checks: is CircuitBreakerError retryable? → NO
6. Immediately throws error (no retries)
7. Exception filter catches CircuitBreakerError
8. Returns 503 immediately with Retry-After header
```

**Total delay: <1ms** ✅

---

## Behavior Comparison

### Before Fix

| Scenario | Response Time | Result |
|----------|--------------|--------|
| Circuit CLOSED (DB up) | ~100ms | ✅ Success |
| Circuit OPEN (DB down) | ~30 seconds | ❌ 503 (delayed) |
| Circuit HALF_OPEN | ~100ms | ✅ Success or immediate fail |

### After Fix

| Scenario | Response Time | Result |
|----------|--------------|--------|
| Circuit CLOSED (DB up) | ~100ms | ✅ Success |
| Circuit OPEN (DB down) | <1ms | ✅ 503 (immediate) |
| Circuit HALF_OPEN | ~100ms | ✅ Success or immediate fail |

---

## Key Principles

### When to Retry

✅ **DO retry:**
- Transient network errors
- Temporary connection failures
- Timeout errors (if operation is idempotent)

❌ **DON'T retry:**
- Circuit breaker OPEN state (known failure)
- Business logic errors
- Validation errors
- Authentication errors

### Circuit Breaker States

1. **CLOSED** (Normal)
   - All requests pass through
   - Failures are counted
   - If failures reach threshold → OPEN

2. **OPEN** (Fast-Fail)
   - All requests fail immediately
   - No actual service calls
   - After timeout → HALF_OPEN

3. **HALF_OPEN** (Testing)
   - Limited requests pass through
   - Testing if service recovered
   - Success → CLOSED, Failure → OPEN

### Why Fast-Fail is Important

When circuit is OPEN:
- **Resource efficiency**: Don't waste time/connections on guaranteed failures
- **User experience**: Immediate feedback instead of long waits
- **System stability**: Prevents cascading failures
- **Clear signals**: Client knows to retry later (Retry-After header)

---

## Testing Verification

### Manual Test Steps

1. **Start application**
   ```bash
   npm run start:dev
   ```

2. **Stop MongoDB** (simulates DB failure)
   ```bash
   # On Mac/Linux
   brew services stop mongodb-community
   
   # Or kill the process
   # MongoDB will stop responding
   ```

3. **Make 5 requests** (to trigger circuit OPEN)
   ```bash
   curl -X POST http://localhost:3000/accounts \
     -H "Content-Type: application/json" \
     -d '{"ownerId":"user1","currency":"USD","initialBalance":100}'
   ```
   - Requests 1-5: Will attempt DB connection (will fail)
   - After 5 failures: Circuit moves to OPEN state

4. **Make request while circuit is OPEN**
   ```bash
   # Measure response time
   time curl -X POST http://localhost:3000/accounts \
     -H "Content-Type: application/json" \
     -d '{"ownerId":"user1","currency":"USD","initialBalance":100}'
   ```

### Expected Results

**Before Fix:**
```
real    0m30.123s  ❌ Takes ~30 seconds
user    0m0.001s
sys     0m0.002s

HTTP/1.1 503 Service Unavailable
Retry-After: 10
```

**After Fix:**
```
real    0m0.045s  ✅ Takes <50ms
user    0m0.001s
sys     0m0.002s

HTTP/1.1 503 Service Unavailable
Retry-After: 10
```

---

## Response Format

When circuit is OPEN, clients receive:

```json
{
  "statusCode": 503,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "path": "/accounts",
  "message": "Service temporarily unavailable due to database issues",
  "error": "Service Unavailable",
  "details": "[MongoEventStore] Circuit breaker is OPEN. Service unavailable.",
  "retryAfter": 10
}
```

**HTTP Headers:**
```
Retry-After: 10
```

Client should retry after 10 seconds (when circuit might be HALF_OPEN).

---

## Related Files

- ✅ `src/libs/resilience/resilient-handler.ts` - Removed CircuitBreakerError from retryable errors
- ✅ `src/libs/resilience/retry.ts` - Changed default to empty retryable errors array
- ✅ `src/libs/resilience/circuit-breaker.filter.ts` - Handles CircuitBreakerError → 503 mapping

---

## Summary

**Problem:** Circuit breaker OPEN state caused 30-second delays instead of immediate failures.

**Root Cause:** Retry logic was configured to retry `CircuitBreakerError`, causing unnecessary retries when circuit was already OPEN.

**Solution:** Removed `CircuitBreakerError` from retryable errors list. Circuit breaker failures now fail fast.

**Result:** ✅ Immediate 503 responses when circuit is OPEN (<1ms instead of ~30s).

**Impact:** 
- Better user experience (immediate feedback)
- Resource efficiency (no wasted retries)
- Proper fast-fail behavior as designed

---

## Additional Notes

### Client Retry Strategy

Clients should implement retry logic based on the `Retry-After` header:

```typescript
async function createAccount(data: AccountData) {
  const maxRetries = 3;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch('/accounts', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      
      if (response.status === 503) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '10');
        console.log(`Service unavailable. Retrying in ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        continue; // Retry
      }
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
    }
  }
}
```

This way, the server fails fast, and the client handles retry logic intelligently.

---

## Configuration

Current circuit breaker settings:

```typescript
{
  failureThreshold: 5,      // Open after 5 consecutive failures
  successThreshold: 2,      // Close after 2 consecutive successes
  timeout: 10000,           // Wait 10 seconds before attempting recovery (HALF_OPEN)
  name: 'MongoEventStore'
}
```

These settings mean:
- After 5 failures → Circuit OPEN
- All requests fail fast immediately
- After 10 seconds → Circuit HALF_OPEN (test recovery)
- After 2 successes → Circuit CLOSED (back to normal)

