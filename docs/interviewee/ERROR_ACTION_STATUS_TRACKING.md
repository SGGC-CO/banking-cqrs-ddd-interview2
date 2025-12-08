# Error Action Status Tracking System

## Overview

The error action status tracking system provides **real-time visibility** into error handler execution:

- ✅ How many actions **succeeded**
- ❌ How many actions **failed**
- ⏳ How many are **pending/running**
- 🔄 How many **retried**
- ⏱️ **Average execution time**

This enables:

- **Monitoring**: Track error handler performance
- **Debugging**: Identify failing handlers and errors
- **Alerting**: Get notified when critical actions fail
- **Health checks**: Verify error system is working

---

## Architecture

### Components

```
ErrorActionStatusService (in-memory tracking)
    ↓
ErrorActionService → Tracks non-critical handlers
ErrorActionQueue → Tracks critical handlers (with retries)
    ↓
Admin endpoints → Query status and statistics
```

### Status States

Each error action goes through these states:

```
pending → running → success
              ↓
           failed → (retrying) → running → success/failed
```

| State        | Meaning                            |
| ------------ | ---------------------------------- |
| **pending**  | Queued, waiting to run             |
| **running**  | Currently executing                |
| **success**  | Completed successfully             |
| **failed**   | Failed after all retries exhausted |
| **retrying** | Failed, will retry soon            |

---

## How It Works

### 1. Non-Critical Event Handlers

When a non-critical error occurs:

```typescript
// ErrorActionService.handleErrorEvent()

// Track status
const actionId = statusService.markPending(event, handlerName, false);

try {
  statusService.markRunning(actionId);
  await handler.handle(event); // Execute
  statusService.markSuccess(actionId);
} catch (err) {
  statusService.markFailed(actionId, err);
}
```

**Timeline**:

```
pending (1ms) → running (100ms) → success
```

### 2. Critical Event Handlers (Queued)

When a critical error occurs:

```typescript
// ErrorActionQueue.processEventWithRetry()

const actionId = statusService.markPending(event, queueHandler, true);

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    statusService.markRunning(actionId);
    await handler.handle(event); // Execute
    statusService.markSuccess(actionId);
    break;
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      statusService.markFailed(actionId, err); // → retrying
      await sleep(delayMs * attempt); // Exponential backoff
    } else {
      statusService.markFailed(actionId, err); // → failed
    }
  }
}
```

**Timeline (with retries)**:

```
pending → running → failed (retry 1) → retrying
          → running → failed (retry 2) → retrying
          → running → success
```

---

## Admin Endpoints

### 1. Get Overall Statistics

```bash
curl http://localhost:3000/admin/error-actions/status
```

**Response**:

```json
{
  "statistics": {
    "totalEvents": 150,
    "pendingCount": 2,
    "runningCount": 1,
    "successCount": 140,
    "failedCount": 7,
    "retriesCount": 12,
    "averageExecutionTimeMs": 245,
    "recentFailures": [
      {
        "id": "1733687649000-xyz123",
        "eventType": "DatabaseConnectionErrorEvent",
        "handlerName": "DatabaseConnectionErrorHandler",
        "status": "failed",
        "startedAt": "2025-12-08T12:14:09Z",
        "completedAt": "2025-12-08T12:14:11Z",
        "attempts": 3,
        "maxAttempts": 3,
        "lastError": "Connection refused",
        "isCritical": true,
        "correlationId": "req-123"
      }
    ],
    "recentSuccesses": [
      // Last 5 successful actions
    ]
  },
  "timestamp": "2025-12-08T12:15:30Z"
}
```

### 2. Get Critical Actions (Pending/Running)

```bash
curl http://localhost:3000/admin/error-actions/critical-pending
```

**Response**:

```json
{
  "criticalPending": [
    {
      "id": "1733687650000-abc123",
      "eventType": "PaymentErrorEvent",
      "handlerName": "PaymentErrorHandler",
      "status": "running",
      "startedAt": "2025-12-08T12:15:20Z",
      "attempts": 2,
      "maxAttempts": 3,
      "isCritical": true,
      "correlationId": "req-456"
    }
  ],
  "count": 1,
  "timestamp": "2025-12-08T12:15:30Z"
}
```

**Use case**: Health checks - Alert if count > 0 for extended period

### 3. Get Critical Failures

```bash
curl http://localhost:3000/admin/error-actions/critical-failures
```

**Response**:

```json
{
  "criticalFailures": [
    {
      "id": "1733687640000-def456",
      "eventType": "DatabaseConnectionErrorEvent",
      "handlerName": "DatabaseConnectionErrorHandler",
      "status": "failed",
      "startedAt": "2025-12-08T12:14:00Z",
      "completedAt": "2025-12-08T12:14:30Z",
      "attempts": 3,
      "maxAttempts": 3,
      "lastError": "Redis: ECONNREFUSED 127.0.0.1:6379",
      "isCritical": true,
      "correlationId": "req-789"
    }
  ],
  "count": 1,
  "timestamp": "2025-12-08T12:15:30Z"
}
```

**Use case**: Debugging - Check why critical actions failed

---

## Monitoring Examples

### 1. Alert on Critical Failures

```bash
#!/bin/bash
FAILURES=$(curl -s http://localhost:3000/admin/error-actions/critical-failures | jq '.count')

if [ "$FAILURES" -gt 5 ]; then
  echo "ALERT: $FAILURES critical errors failed!" | mail -s "Critical Alert" ops@company.com
fi
```

### 2. Health Check Script

```bash
#!/bin/bash
PENDING=$(curl -s http://localhost:3000/admin/error-actions/critical-pending | jq '.count')

if [ "$PENDING" -gt 10 ]; then
  echo "WARNING: $PENDING critical actions stuck pending"
  exit 1
else
  echo "OK: All critical actions processing"
  exit 0
fi
```

### 3. Performance Dashboard

```bash
#!/bin/bash
curl http://localhost:3000/admin/error-actions/status | jq '{
  success: .statistics.successCount,
  failed: .statistics.failedCount,
  pending: .statistics.pendingCount,
  avgTime: .statistics.averageExecutionTimeMs
}'
```

---

## Example Flow

### Scenario: Payment Error with Retry

```
1️⃣ Payment fails
   └→ PaymentErrorEvent published
   └→ PaymentErrorHandler registered

2️⃣ Handler processes
   [pending] 0ms
   └→ Tries to refund
   └→ Refund service down (failure)

   [running] 10-100ms
   └→ Check: attempt 1 < maxAttempts (3)?
   └→ Yes → markFailed() → [retrying]

3️⃣ First retry (backoff 1000ms)
   [running] 1100ms
   └→ Tries to refund again
   └→ Still down (failure)

   [running] 1100-1200ms
   └→ Check: attempt 2 < maxAttempts (3)?
   └→ Yes → markFailed() → [retrying]

4️⃣ Second retry (backoff 2000ms)
   [running] 3200ms
   └→ Tries to refund again
   └→ Success! ✅

   [success] 3200-3300ms
   └→ markSuccess()
   └→ Action completed

Total attempts: 3
Total time: ~3.3 seconds
Status: success ✅
```

### Status Query After Success

```bash
curl http://localhost:3000/admin/error-actions/status | jq '.statistics'
```

```json
{
  "totalEvents": 1,
  "successCount": 1,
  "failedCount": 0,
  "retriesCount": 2,
  "averageExecutionTimeMs": 3300
}
```

---

## Implementation Details

### In-Memory Storage

Status is stored in-memory (in `ErrorActionStatusService`):

```typescript
private statusMap = new Map<string, ErrorActionStatusRecord>();      // Active
private completedActions: ErrorActionStatusRecord[] = [];              // Completed
private readonly maxStoredActions = 1000;                              // Keep last 1000
```

**Pros**:

- ✅ Fast access (no DB)
- ✅ Real-time updates
- ✅ Easy to query

**Cons**:

- ❌ Lost on restart
- ❌ Not persisted

### Future: Persist to Database

For production, extend to persist:

```typescript
@Injectable()
export class ErrorActionStatusService {
  constructor(private db: Database) {}

  async archiveAction(record: ErrorActionStatusRecord) {
    // Insert completed action to database
    await this.db.collection("error_action_history").insertOne(record);

    // Keep only recent in memory
    this.completedActions = this.completedActions.slice(-100);
  }
}
```

---

## Best Practices

### 1. Regular Monitoring

Poll the status endpoint every 30 seconds:

```bash
# monitoring/check-error-actions.sh
while true; do
  curl -s http://localhost:3000/admin/error-actions/critical-pending | \
    jq -e '.count == 0' || echo "ALERT: Critical actions pending"
  sleep 30
done
```

### 2. Alert on Failures

```bash
# Alert if any critical action failed
curl -s http://localhost:3000/admin/error-actions/critical-failures | \
  jq -e '.count > 0' && send_alert
```

### 3. Dashboard Display

```typescript
// Get all stats for dashboard
async function refreshDashboard() {
  const stats = await fetch("/admin/error-actions/status").then((r) =>
    r.json(),
  );

  // Display metrics
  document.getElementById("success").textContent =
    stats.statistics.successCount;
  document.getElementById("failed").textContent = stats.statistics.failedCount;
  document.getElementById("pending").textContent =
    stats.statistics.pendingCount;
  document.getElementById("avgTime").textContent =
    stats.statistics.averageExecutionTimeMs + "ms";
}

setInterval(refreshDashboard, 5000); // Update every 5 seconds
```

---

## Troubleshooting

### High Failure Count

```bash
# Check what's failing
curl http://localhost:3000/admin/error-actions/critical-failures | jq '.criticalFailures[].lastError'
```

**Common issues**:

- Refund service down → Check service health
- Database unavailable → Check MongoDB/Redis connectivity
- Handler bug → Check logs for stack traces

### Stuck Pending Actions

```bash
# Check how long they've been pending
curl http://localhost:3000/admin/error-actions/critical-pending | \
  jq '.criticalPending[] | {id, startedAt, duration: (now - (.startedAt | fromdate))}'
```

**Solutions**:

- Restart application to reset queue
- Check handler implementation for infinite loops
- Add timeout to handler execution

---

## Summary

| Feature               | Endpoint                                 | Use Case                     |
| --------------------- | ---------------------------------------- | ---------------------------- |
| **Statistics**        | `/admin/error-actions/status`            | Dashboard, KPIs              |
| **Critical Pending**  | `/admin/error-actions/critical-pending`  | Health checks, alerts        |
| **Critical Failures** | `/admin/error-actions/critical-failures` | Debugging, incident response |

**Benefits**:

- ✅ Real-time visibility into error handling
- ✅ Monitor handler performance
- ✅ Detect and alert on failures
- ✅ Debug issues quickly
- ✅ Track retry attempts and backoff
