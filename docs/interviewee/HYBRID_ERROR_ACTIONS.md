# Hybrid Error Action System

## Overview

We have implemented a **Hybrid Error Action System** that balances speed and reliability:

1.  **Fire-and-Forget (Fast)**: For non-critical actions (e.g., logging, metrics).
2.  **Guaranteed Execution (Reliable)**: For critical actions (e.g., refunds, data consistency).

---

## How It Works

### 1. Event Classification

Error events are now classified as `critical` or `non-critical` via the `isCritical` flag in `ErrorEvent`.

- **Critical Events**:
  - `PaymentErrorEvent` (Money involved)
  - `DatabaseConnectionErrorEvent` (Infrastructure failure)
- **Non-Critical Events**:
  - `ExternalServiceErrorEvent` (Can retry later)
  - `ConcurrencyErrorEvent` (User can retry)

### 2. Routing Logic (`ErrorActionService`)

When an error occurs:

```typescript
if (event.isCritical) {
  // Route to Queue (Guaranteed Execution)
  await this.errorActionQueue.add(event);
} else {
  // Route to Immediate Execution (Fire-and-Forget)
  this.executeHandlersParallel(event);
}
```

### 3. Critical Action Queue (`ErrorActionQueue`)

The queue ensures that critical actions are:

- **Persisted**: Uses **Redis** (via `ioredis`) for durability across restarts.
- **Hybrid Fallback**: Automatically switches to **In-Memory** queue if Redis is unavailable (best-effort while degraded).
- **Retried**: Automatically retries failed actions up to 3 times with backoff.
- **Processed Sequentially**: Ensures order and avoids race conditions.

```typescript
// Hybrid Queue Logic
if (this.useRedis) {
  await this.redis.rpush(KEY, JSON.stringify(event));
} else {
  this.queue.push(event); // Fallback
}
```

**Operational note:** When running on the in-memory fallback (e.g., Redis down), critical events are not durable across process restarts; restore Redis quickly to regain durability.

---

## Benefits

| Feature         | Fire-and-Forget  | Guaranteed Queue              |
| :-------------- | :--------------- | :---------------------------- |
| **Speed**       | ⚡ Instant       | 🐢 Asynchronous               |
| **Reliability** | ⚠️ Best Effort   | ✅ Guaranteed                 |
| **Persistence** | ❌ None          | ✅ Redis + In-Memory Fallback |
| **Order**       | ❌ Parallel      | ✅ Sequential                 |
| **Use Case**    | Logging, Metrics | Refunds, Consistency          |

## Future Improvements

1.  **Dead Letter Queue (DLQ)**: Move permanently failed events to a DLQ for manual inspection.
2.  **Dashboard**: Visualize queue depth and failed events.
3.  **Distributed Locking**: Ensure only one instance processes the queue in a clustered environment.
