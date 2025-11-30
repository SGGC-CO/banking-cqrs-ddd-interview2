# Concurrent Duplicate Requests During Retry - Analysis

## Problem Scenarios

### Scenario 1: Open Account (Different IDs - Safe)

```
Request 1: POST /accounts {"ownerId":"user1","currency":"USD"}
           → accountId = uuid() = "abc-123"
           → Retrying...

Request 2: POST /accounts {"ownerId":"user1","currency":"USD"} (SAME DATA)
           → accountId = uuid() = "xyz-789" (DIFFERENT!)
           → Works fine, creates different account ✅
```

**Result:** ✅ Safe - Each request gets unique UUID

---

### Scenario 2: Deposit (RACE CONDITION! ❌)

```
Request 1: POST /accounts/abc-123/deposit {"amount":100}
           → Load aggregate (version 5)
           → Add deposit event (version 6)
           → Retrying save...

Request 2: POST /accounts/abc-123/deposit {"amount":100} (DUPLICATE!)
           → Load aggregate (version 5) - same version!
           → Add deposit event (version 6)
           → Try to save
           → CONFLICT! Both trying to write version 6
```

**Result:** ❌ **RACE CONDITION** - Double deposit possible!

---

### Scenario 3: Withdraw (Same Problem)

```
Request 1: POST /accounts/abc-123/withdraw {"amount":50}
           → Load aggregate (version 5)
           → Add withdraw event (version 6)
           → Retrying save...

Request 2: POST /accounts/abc-123/withdraw {"amount":50} (DUPLICATE!)
           → Load aggregate (version 5)
           → Add withdraw event (version 6)
           → CONFLICT!
```

**Result:** ❌ **RACE CONDITION** - Double withdrawal possible!

---

## Detailed Timeline

### What Actually Happens

```
Time    Request 1                           Request 2
─────────────────────────────────────────────────────────────────
0s      POST /deposit {"amount": 100}
        Load aggregate (v=5, balance=500)
        Apply: DepositedEvent(100)
        agg.version = 6
        agg.balance = 600
        
0.5s    Attempt 1: store.append(v=5, [Event])
        → Circuit OPEN ❌
        → Events restored
        → agg.version = 5 (restored)
        
1s                                          POST /deposit {"amount": 100}
                                            Load aggregate (v=5, balance=500)
                                            Apply: DepositedEvent(100)
                                            agg.version = 6
                                            agg.balance = 600
                                            
2.5s    Attempt 2: store.append(v=5, [Event])
        → Circuit HALF_OPEN
        → MongoDB: Insert version 6 ✅
        → Events published
        → Response: 200 OK
        
3s                                          Attempt 1: store.append(v=5, [Event])
                                            → MongoDB: Duplicate key error! ❌
                                            → E11000: version 6 already exists
                                            → Throws Error
```

---

## Current Behavior

### MongoDB Protection (Partial)

The unique index on `(aggregateId, version)` prevents duplicate persistence:

```typescript
// In MongoEventStore constructor
this.events.createIndex(
  { aggregateId: 1, version: 1 }, 
  { unique: true }
);
```

**What happens:**
```
Request 1: Writes version 6 → SUCCESS ✅
Request 2: Tries to write version 6 → E11000 Duplicate Key Error ❌
```

### Problem with Current Error Handling

```typescript
// In MongoEventStore.append()
catch (e: any) {
  if (e?.message?.includes('E11000')) {
    throw new Error('ConcurrencyError: aggregate version conflict');
  }
  throw e;
}
```

Request 2 gets:
```
500 Internal Server Error
"ConcurrencyError: aggregate version conflict"
```

This is **correct behavior** but the **error message is confusing** for duplicate requests!

---

## Solutions

### Solution 1: Idempotency Key (Recommended)

Add idempotency tracking for deposit/withdraw operations:

```typescript
interface IdempotencyRecord {
  key: string;           // Hash of (accountId + operation + amount + timestamp)
  accountId: string;
  operation: string;
  result: any;
  expiresAt: Date;
}
```

Implementation:

```typescript
export class DepositHandler {
  async execute(cmd: DepositCommand) {
    // Generate idempotency key
    const idempotencyKey = this.generateKey(cmd);
    
    // Check if already processed
    const existing = await this.idempotency.get(idempotencyKey);
    if (existing) {
      console.log(`[Idempotency] Duplicate request detected: ${idempotencyKey}`);
      return existing.result; // Return cached result
    }
    
    // Process normally
    const acc = await this.repo.getById(cmd.accountId);
    if (!acc) throw new Error('Account not found');
    
    acc.deposit(cmd.amount);
    
    await retry(() => this.repo.save(acc), {...});
    
    const result = { accountId: cmd.accountId };
    
    // Store result for 24 hours
    await this.idempotency.set(idempotencyKey, result, 86400);
    
    return result;
  }
}
```

---

### Solution 2: Request Deduplication Middleware

Add middleware to detect and hold duplicate requests:

```typescript
export class DeduplicationMiddleware {
  private pending = new Map<string, Promise<any>>();
  
  async deduplicate(key: string, fn: () => Promise<any>) {
    // If same request is already processing, wait for it
    if (this.pending.has(key)) {
      console.log(`[Dedup] Waiting for in-flight request: ${key}`);
      return this.pending.get(key);
    }
    
    // Start processing
    const promise = fn().finally(() => {
      this.pending.delete(key);
    });
    
    this.pending.set(key, promise);
    return promise;
  }
}
```

Usage:

```typescript
export class DepositHandler {
  async execute(cmd: DepositCommand) {
    const key = `deposit:${cmd.accountId}:${cmd.amount}`;
    
    return this.dedup.deduplicate(key, async () => {
      const acc = await this.repo.getById(cmd.accountId);
      if (!acc) throw new Error('Account not found');
      
      acc.deposit(cmd.amount);
      await retry(() => this.repo.save(acc), {...});
      
      return { accountId: cmd.accountId };
    });
  }
}
```

---

### Solution 3: Better Error Response for Version Conflicts

Update repository to differentiate between concurrency and duplicates:

```typescript
async save(aggregate: Account) {
  const events = aggregate.pullUncommittedEvents();
  
  try {
    await this.store.append(...);
    
    if (this.bus && events.length) {
      for (const ev of events) await this.bus.publish(ev);
    }
  } catch (error) {
    if (error instanceof CircuitBreakerError) {
      aggregate.restoreUncommittedEvents(events);
      throw error;
    }
    
    // Check if it's a version conflict
    if (error.message?.includes('ConcurrencyError')) {
      // Reload and check if same operation already applied
      const current = await this.getById(aggregate.id!);
      if (this.isSameState(current, aggregate)) {
        console.log(`[Repository] Duplicate operation detected, already applied`);
        return; // Idempotent - already done
      }
      throw error; // Real concurrency conflict
    }
    
    throw error;
  }
}

private isSameState(agg1: Account, agg2: Account): boolean {
  return JSON.stringify(agg1.toJSON()) === JSON.stringify(agg2.toJSON());
}
```

---

## Summary Table

| Scenario | Duplicate Request Arrives | Current Behavior | Risk Level |
|----------|--------------------------|------------------|------------|
| **Open Account** | During retry | Creates different account (different UUID) | ✅ Safe |
| **Deposit** | During retry | Version conflict error (E11000) | ⚠️ Protected but confusing error |
| **Withdraw** | During retry | Version conflict error (E11000) | ⚠️ Protected but confusing error |
| **Deposit** | After first succeeds | Version conflict + wrong state | ❌ Dangerous |

---

## Recommended Implementation Priority

1. **High Priority:** Idempotency key for deposit/withdraw
2. **Medium Priority:** Request deduplication middleware
3. **Low Priority:** Better error messages for version conflicts

---

## Timeline with Idempotency

```
Time    Request 1                           Request 2
─────────────────────────────────────────────────────────────────
0s      POST /deposit {"amount": 100}
        idempotencyKey = "hash-abc"
        Check cache: MISS
        Process...
        
1s                                          POST /deposit {"amount": 100}
                                            idempotencyKey = "hash-abc"
                                            Check cache: HIT! ✅
                                            Return cached result immediately
                                            
2.5s    Request 1 completes
        Cache result for 24h
        Response: 200 OK
```

**Result:** ✅ Safe, both requests get same response, only processed once!
