# Idempotency Key Fix - Handling Legitimate Duplicate Requests

## Problem

The idempotency system was preventing legitimate duplicate requests. For example:

```
User wants to deposit $100 twice within 60 seconds:
- Request 1: POST /accounts/abc/deposit {"amount": 100}
  → Idempotency key: hash("deposit", "abc", 100) = "key-123"
  → Processed and cached
  
- Request 2: POST /accounts/abc/deposit {"amount": 100} (2 seconds later)
  → Idempotency key: hash("deposit", "abc", 100) = "key-123" (SAME!)
  → Cache hit → Request ignored ❌
```

**Result:** Second legitimate deposit was blocked, causing user frustration.

---

## Root Cause

The idempotency key was generated from command parameters:
- `hash(operation, accountId, amount)`
- Same parameters = same key = blocked as duplicate

This works for preventing accidental retries, but blocks intentional duplicate operations.

---

## Solution: Client-Provided Idempotency Keys with Backend Fallback

### Approach

1. **Client provides `Idempotency-Key` header** (optional)
   - If provided: Use it for idempotency checking
   - If not provided: Backend generates a unique key per request (allows all requests through)

2. **Benefits:**
   - ✅ Clients can prevent duplicates by using the same key
   - ✅ Clients can make legitimate duplicates by using different keys
   - ✅ Backward compatible - no header needed (backend handles it)
   - ✅ All requests go through when no client key provided

### Implementation

#### 1. Controller - Extract Header

```typescript
// src/modules/accounts/http/accounts.controller.ts
@Post(':id/deposit')
async deposit(
  @Param('id') id: string,
  @Body() dto: AmountDto,
  @Headers('idempotency-key') idempotencyKey?: string,  // ← Extract header
) {
  await this.commands.execute(new DepositCommand(id, dto.amount, idempotencyKey));
  return { accountId: id };
}
```

#### 2. Command - Accept Key

```typescript
// src/modules/accounts/application/commands/deposit.command.ts
export class DepositCommand extends Command {
  constructor(
    public readonly accountId: string,
    public readonly amount: number,
    public readonly idempotencyKey?: string,  // ← Optional key
  ) {
    super();
  }
}
```

#### 3. Handler - Idempotency with Fallback

```typescript
// src/modules/accounts/application/handlers/deposit.handler.ts
protected isIdempotent(cmd: DepositCommand): boolean {
  // Always enable idempotency (backend handles key generation)
  return true;
}

protected generateIdempotencyKey(cmd: DepositCommand): string {
  // If client provided key, use it
  if (cmd.idempotencyKey) {
    return this.idempotency!.generateKey("deposit", cmd.idempotencyKey);
  }
  
  // Fallback: Generate unique key per request (allows all requests through)
  return this.generateFallbackIdempotencyKey(cmd);
}

protected generateFallbackIdempotencyKey(cmd: DepositCommand): string {
  // Generate unique key: params + UUID ensures each request is unique
  const requestId = randomUUID();
  return this.idempotency!.generateKey("deposit", cmd.accountId, cmd.amount, requestId);
}
```

#### 4. Base Handler - Pass Command to isIdempotent()

```typescript
// src/libs/resilience/resilient-handler.ts
async execute(cmd: TCommand): Promise<TResult> {
  // Pass command to isIdempotent() to allow dynamic checking
  if (this.idempotency && this.isIdempotent(cmd)) {
    // ... idempotency logic
  }
  // ... rest of execution
}

protected isIdempotent(cmd: TCommand): boolean {
  return true;  // Can now check command properties
}
```

---

## Usage Examples

### Scenario 1: Prevent Duplicate Retries

**Client wants to prevent duplicate processing when retrying:**

```bash
# First request
curl -X POST http://localhost:3000/accounts/abc/deposit \
  -H "Idempotency-Key: req-123" \
  -H "Content-Type: application/json" \
  -d '{"amount": 100}'

# Retry (same key) - Returns cached result
curl -X POST http://localhost:3000/accounts/abc/deposit \
  -H "Idempotency-Key: req-123" \
  -H "Content-Type: application/json" \
  -d '{"amount": 100}'
```

**Result:** ✅ Second request returns cached result (no duplicate deposit)

---

### Scenario 2: Legitimate Duplicate Operations

**Client wants to deposit $100 twice:**

```bash
# First deposit
curl -X POST http://localhost:3000/accounts/abc/deposit \
  -H "Idempotency-Key: deposit-1" \
  -H "Content-Type: application/json" \
  -d '{"amount": 100}'

# Second deposit (different key)
curl -X POST http://localhost:3000/accounts/abc/deposit \
  -H "Idempotency-Key: deposit-2" \
  -H "Content-Type: application/json" \
  -d '{"amount": 100}'
```

**Result:** ✅ Both deposits processed (different keys)

---

### Scenario 3: No Idempotency Key (Backend Fallback)

**Client doesn't provide key - backend generates unique key:**

```bash
# No header - backend generates unique key per request
curl -X POST http://localhost:3000/accounts/abc/deposit \
  -H "Content-Type: application/json" \
  -d '{"amount": 100}'

# Second request (no header) - backend generates different unique key
curl -X POST http://localhost:3000/accounts/abc/deposit \
  -H "Content-Type: application/json" \
  -d '{"amount": 100}'
```

**Result:** ✅ Both requests processed (each gets unique backend-generated key)

---

## Behavior Summary

| Scenario | Client Key | Server Behavior |
|----------|-----------|-----------------|
| **Prevent Duplicate** | Same key in retry | Return cached result ✅ |
| **Legitimate Duplicate** | Different keys | Process both ✅ |
| **No Key Provided** | No header | Backend generates unique key per request ✅ |
| **Circuit Breaker** | Same key | Cached result prevents double-processing ✅ |

---

## Trade-offs

### ✅ Pros

1. **Flexible:** Clients control idempotency behavior
2. **Standard:** Follows REST API best practices (Stripe, PayPal pattern)
3. **Backward Compatible:** Works without header
4. **Prevents Bugs:** No more blocking legitimate duplicates

### ⚠️ Considerations

1. **Client Responsibility:** Clients should provide keys for duplicate prevention
2. **Backend Fallback:** Without header, backend generates unique keys (all requests processed)
3. **Circuit Breaker Protection:** Works in all scenarios
4. **Best Practice:** Clients should always provide idempotency keys for better control

---

## Migration Guide

### For API Clients

**Before (Auto-deduped, but blocked duplicates):**
```bash
curl -X POST /accounts/abc/deposit -d '{"amount": 100}'
# Auto-generated key blocked duplicates
```

**After (Client-controlled):**
```bash
# Option 1: Prevent duplicates
curl -X POST /accounts/abc/deposit \
  -H "Idempotency-Key: unique-key-123" \
  -d '{"amount": 100}'

# Option 2: Allow duplicates
curl -X POST /accounts/abc/deposit \
  -H "Idempotency-Key: key-1" \
  -d '{"amount": 100}'
  
curl -X POST /accounts/abc/deposit \
  -H "Idempotency-Key: key-2" \
  -d '{"amount": 100}'
```

---

## Testing

### Test Case 1: Duplicate Prevention

```typescript
// Same key = cached result
const key = 'test-key-123';
await deposit(accountId, 100, key);
await deposit(accountId, 100, key);  // Should return cached
// Only one deposit processed
```

### Test Case 2: Legitimate Duplicates

```typescript
// Different keys = both processed
await deposit(accountId, 100, 'key-1');
await deposit(accountId, 100, 'key-2');
// Both deposits processed
```

### Test Case 3: No Key (Backend Fallback)

```typescript
// No key = backend generates unique keys
await deposit(accountId, 100);  // Backend key: uuid-1
await deposit(accountId, 100);  // Backend key: uuid-2 (different)
// Both deposits processed (each has unique backend-generated key)
```

---

## Conclusion

This fix resolves the bug by making idempotency **opt-in and client-controlled**, following industry-standard patterns. Clients can now:

- ✅ Prevent duplicate processing (use same key)
- ✅ Make legitimate duplicates (use different keys)
- ✅ Work without keys (backward compatible)

The system is now more flexible while maintaining protection against accidental duplicates.

