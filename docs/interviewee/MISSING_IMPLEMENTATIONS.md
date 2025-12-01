# Missing or Incomplete Parts of the Codebase

This document identifies all incomplete implementations, TODOs, and missing features in the banking CQRS/DDD application.

---

## 🔴 Critical Missing Implementations

### 1. **CommandBus.execute()** - Command Execution Logic
**Location:** `src/libs/cqrs/command-bus.ts:20-23`

**Status:** ❌ **NOT IMPLEMENTED** - Throws error

**Current Code:**
```typescript
async execute<T extends Command, R = any>(command: T): Promise<R> {
  // TODO: Implement command execution
  throw new Error('Method not implemented');
}
```

**Expected Implementation:**
- Look up handler by command class name (similar to QueryBus)
- Call handler's execute method
- Return result

**Reference Implementation:** See `QueryBus.execute()` in `src/libs/cqrs/query-bus.ts:16-20`

**Impact:** ⚠️ **HIGH** - All command execution fails. This breaks:
- Opening accounts
- Depositing money
- Withdrawing money

---

### 2. **AggregateRoot.rehydrate()** - Aggregate Restoration from Events
**Location:** `src/libs/cqrs/aggregate-root.ts:37-40`

**Status:** ❌ **NOT IMPLEMENTED** - Throws error

**Current Code:**
```typescript
static rehydrate(events: any[]): any {
  // TODO: Implement aggregate rehydration from event history
  throw new Error('Method not implemented');
}
```

**Usage:** Called by `AccountEventRepository.getById()` at line 15

**Expected Implementation:**
- Create new instance of the aggregate
- Apply all events to rebuild state
- Set version to match event count
- Return rehydrated aggregate

**Pattern:**
```typescript
static rehydrate(events: any[]): Account {
  const account = new Account();
  for (const event of events) {
    // Apply event without adding to _pending
    const handler = account[`on${event.constructor.name}`];
    if (handler) handler.call(account, event);
    account.setVersion(account.version + 1);
  }
  return account;
}
```

**Impact:** ⚠️ **HIGH** - Cannot load existing accounts from event store

---

### 3. **AccountsProjection - WithdrawnEvent Handling**
**Location:** `src/modules/accounts/infra/projection/accounts.projection.ts:57-64`

**Status:** ❌ **INCOMPLETE** - Throws error

**Current Code:**
```typescript
/**
 * Handle withdrawal event
 * INCOMPLETE - TO BE IMPLEMENTED BY INTERVIEWEE
 */
if (event instanceof WithdrawnEvent) {
  // TODO: Implement withdrawal projection
  throw new Error("Method not implemented");
}
```

**Expected Implementation:**
- Decrement balance in read model
- Similar to DepositedEvent but using `$inc: { balance: -event.amount }`

**Reference:** See DepositedEvent handling at lines 49-54

**Impact:** ⚠️ **MEDIUM** - Read model balance incorrect after withdrawals

---

## 🟡 Optional Enhancements (Suggested in Comments)

### 4. **AdminController - Event Viewing & Replay Endpoints**
**Location:** `src/modules/admin/admin.controller.ts:47-54`

**Status:** ⚠️ **SUGGESTED FEATURE** - Comment only

**Current Code:**
```typescript
/**
 * INCOMPLETE - TO BE IMPLEMENTED BY INTERVIEWEE
 * 
 * Suggested implementation:
 * - Add an endpoint to view all events in the system
 * - Add an endpoint to replay events and rebuild projections
 */
```

**Suggested Endpoints:**
- `GET /admin/events` - List all events (with pagination)
- `GET /admin/events/:aggregateId` - View events for specific aggregate
- `POST /admin/projections/rebuild` - Replay all events to rebuild projections
- `POST /admin/projections/rebuild/:aggregateId` - Rebuild specific aggregate projection

**Impact:** ℹ️ **LOW** - Useful for debugging and maintenance

---

## ✅ Actually Complete (Despite Comments)

### 5. **WithdrawHandler.executeInternal()**
**Location:** `src/modules/accounts/application/handlers/withdraw.handler.ts:23-31`

**Status:** ✅ **ACTUALLY COMPLETE** - Comment is misleading

**Note:** Has comment "INCOMPLETE - TO BE IMPLEMENTED BY INTERVIEWEE" but implementation is complete:
- Loads account
- Validates account exists
- Calls aggregate.withdraw()
- Saves aggregate
- Returns result

**Action:** Remove misleading comment

---

## 📋 Summary Table

| # | Component | Status | Priority | Impact |
|---|-----------|--------|----------|--------|
| 1 | CommandBus.execute() | ❌ Missing | 🔴 Critical | HIGH - Breaks all commands |
| 2 | AggregateRoot.rehydrate() | ❌ Missing | 🔴 Critical | HIGH - Cannot load accounts |
| 3 | WithdrawnEvent projection | ❌ Incomplete | 🟡 Medium | MEDIUM - Read model incorrect |
| 4 | Admin endpoints | ⚠️ Suggested | 🟢 Low | LOW - Nice to have |
| 5 | WithdrawHandler | ✅ Complete | - | - |

---

## 🎯 Implementation Order

### Priority 1: Critical Path Fixes
1. **CommandBus.execute()** - Required for application to function
2. **AggregateRoot.rehydrate()** - Required for loading existing data

### Priority 2: Functional Completeness
3. **WithdrawnEvent projection** - Complete the read model

### Priority 3: Enhancements
4. **Admin endpoints** - Operational tooling

---

## 🔍 How to Verify Completeness

### Test CommandBus
```typescript
// Should work without throwing
const result = await commandBus.execute(new OpenAccountCommand(...));
```

### Test Aggregate Rehydration
```typescript
// Should create account from events
const account = Account.rehydrate(events);
expect(account.balance).toBe(expectedBalance);
```

### Test Withdrawal Projection
```typescript
// Should decrement balance
await projection.project(new WithdrawnEvent('id', 100));
const doc = await collection.findOne({ accountId: 'id' });
expect(doc.balance).toBe(previousBalance - 100);
```

---

## 📚 Related Files

- **Command Pattern:** `src/libs/cqrs/command-bus.ts`
- **Event Sourcing:** `src/libs/cqrs/aggregate-root.ts`
- **Read Model:** `src/modules/accounts/infra/projection/accounts.projection.ts`
- **Admin Tools:** `src/modules/admin/admin.controller.ts`
- **Interview Guide:** `interview.md` (lines 24-29 list these tasks)

---

## 💡 Implementation Hints

### CommandBus Pattern
Look at `QueryBus.execute()` - it follows the same pattern:
1. Get command class name
2. Look up handler in Map
3. Execute handler
4. Return result

### Rehydration Pattern
The `apply()` method already handles event application. For rehydration:
- Create new instance
- Call event handlers directly (without `apply()` to avoid adding to pending)
- Set version manually

### Projection Pattern
Look at `DepositedEvent` handling - WithdrawnEvent should be similar but decrement instead of increment.

