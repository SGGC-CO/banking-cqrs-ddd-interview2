# Redis Failure Scenarios & Recovery in Error Action Queue

## Overview

The `ErrorActionQueue` implements a **hybrid Redis + in-memory fallback** system that gracefully handles Redis failures at any point during the application lifecycle.

---

## Scenario 1: Redis Fails During App Startup

### What Happens:

```
1. ErrorActionQueue constructor tries to connect to Redis
2. Redis connection fails or times out
3. Catch block is triggered
4. useRedis flag set to FALSE
5. startRedisReconnectLoop() begins automatic reconnection attempts
6. App continues with in-memory queue (no crash)
```

### Code Flow:

```typescript
try {
  this.redis = new Redis({...});
  // ... event listeners setup ...
} catch (error) {
  this.logger.warn("Failed to initialize Redis client, using in-memory queue");
  this.useRedis = false;
  this.startRedisReconnectLoop(); // ← Automatic reconnection starts
}
```

### User Experience:

- ✅ App starts normally
- ✅ Error actions are queued in memory
- ✅ All critical errors are still handled
- ⚠️ Queue data lost if app restarts (but will have in-memory items until shutdown)
- 🔄 Every 10 seconds: app attempts to reconnect to Redis

---

## Scenario 2: Redis Connection Breaks in the Middle of App Running

### What Happens:

```
1. Redis connection is active (useRedis = true)
2. Redis server crashes, restarts, or network breaks
3. Redis "error" or "close" event fires
4. useRedis flag set to FALSE
5. startRedisReconnectLoop() begins automatic reconnection attempts
6. App switches to in-memory queue for new items
7. Items already in Redis queue may be lost
```

### Code Flow:

```typescript
this.redis.on("error", (err) => {
  this.logger.error("Redis error in Error Action Queue", err);
  this.useRedis = false;
  this.startRedisReconnectLoop(); // ← Automatic reconnection starts
});

this.redis.on("close", () => {
  this.logger.warn("Redis connection closed, switching to in-memory mode");
  this.useRedis = false;
  this.startRedisReconnectLoop(); // ← Automatic reconnection starts
});
```

### Timeline Example:

```
00:00 - Redis connection active (useRedis = true)
00:05 - Redis crashes
00:05 - "error" event fired → useRedis = false
00:05 - Reconnection loop starts
00:07 - User triggers payment error → queued in MEMORY (not Redis)
00:15 - Redis comes back online
00:15 - Ping succeeds → Redis reconnected
00:15 - useRedis = true, processQueue() resumes
00:15 - In-memory queue items start processing from Redis
```

### User Experience:

- ✅ App doesn't crash
- ✅ New errors continue to be queued (in memory)
- ⚠️ Items that were in Redis queue are lost
- ⚠️ But items added during downtime are in in-memory queue
- 🔄 Automatic reconnection every 10 seconds

---

## Scenario 3: Redis Fails During Queue Processing

### What Happens:

```
1. processQueue() is running
2. redis.lpop() throws an error (Redis unavailable)
3. Error caught in try-catch block
4. useRedis flag set to FALSE
5. Fallback to in-memory queue
6. Reconnection loop starts
```

### Code Flow:

```typescript
// 1. Try to get from Redis first
if (this.useRedis && this.redis) {
  try {
    const payload = await this.redis.lpop(this.REDIS_KEY);
    if (payload) {
      const parsed = JSON.parse(payload);
      event = this.reconstructEvent(parsed);
    }
  } catch (error) {
    this.logger.error("Error reading from Redis queue", error);
    this.useRedis = false; // ← Switch to in-memory
    // Reconnection will start on next error or when add() is called
  }
}

// 2. If no Redis item, check in-memory queue
if (!event && this.queue.length > 0) {
  event = this.queue.shift() || null; // ← Fallback works
}
```

### User Experience:

- ✅ Processing continues with in-memory queue
- ⚠️ Items in Redis queue are stuck
- ✅ New items added go to in-memory

---

## Scenario 4: Redis Reconnects Successfully

### What Happens:

```
1. Reconnection interval running (every 10 seconds)
2. redis.ping() succeeds
3. useRedis flag set to TRUE
4. clearRedisReconnectInterval() stops the loop
5. processQueue() resumes from where it left
6. In-memory queue items continue processing
```

### Code Flow:

```typescript
private startRedisReconnectLoop() {
  this.redisReconnectInterval = setInterval(() => {
    if (!this.useRedis && this.redis) {
      this.logger.log("Attempting to reconnect to Redis for Error Action Queue...");
      this.redis?.ping()
        .then(() => {
          this.logger.log("Redis reconnected successfully!");
          this.useRedis = true;
          this.clearRedisReconnectInterval(); // ← Stop loop
          this.processQueue(); // ← Resume processing
        })
        .catch((err) => {
          this.logger.debug("Redis reconnection attempt failed", err.message);
        });
    }
  }, this.REDIS_RECONNECT_INTERVAL); // 10 seconds
}
```

### Timeline Example:

```
00:00 - Redis down, useRedis = false
00:05 - Reconnection attempt → fails
00:15 - Reconnection attempt → fails
00:25 - Redis comes back online
00:25 - Reconnection attempt → SUCCEEDS
00:25 - useRedis = true
00:25 - processQueue() resumes
00:26 - All in-memory queued items start processing
```

### User Experience:

- ✅ App automatically recovers without restart
- ✅ In-memory queue items resume processing
- ⚠️ Items that were in Redis are lost (durability issue)
- 🚀 Zero manual intervention needed

---

## Scenario 5: App Shutdown with Pending Items

### What Happens:

```
1. App receives shutdown signal (SIGTERM, etc.)
2. NestJS calls onModuleDestroy() lifecycle hook
3. Reconnection interval is cleared
4. Redis connection is gracefully closed
5. In-memory queue items are lost
6. Processing stops
```

### Code Flow:

```typescript
async onModuleDestroy() {
  this.clearRedisReconnectInterval(); // ← Stop reconnection attempts
  if (this.redis) {
    try {
      await this.redis.quit(); // ← Graceful close
    } catch (error) {
      this.logger.error("Error closing Redis connection", error);
    }
  }
}
```

### User Experience:

- ✅ Clean shutdown
- ⚠️ In-memory queue items are lost
- ⚠️ Redis queue items may be lost if not persisted

---

## Scenario 6: Redis Write Fails (add method)

### What Happens:

```
1. Critical error happens
2. add() method tries to write to Redis
3. redis.rpush() throws an error
4. Catch block triggered
5. useRedis set to FALSE
6. Item added to in-memory queue instead
7. Processing continues normally
```

### Code Flow:

```typescript
async add(event: ErrorEvent): Promise<void> {
  if (this.useRedis && this.redis) {
    try {
      const payload = JSON.stringify({...});
      await this.redis.rpush(this.REDIS_KEY, payload);
    } catch (error) {
      this.logger.error(
        "Failed to add to Redis queue, falling back to in-memory",
        error,
      );
      this.useRedis = false;
      this.addToInMemory(event); // ← Fallback works
    }
  } else {
    this.addToInMemory(event);
  }
}
```

### User Experience:

- ✅ Error is still queued (no data loss during write)
- ✅ Processing continues
- ⚠️ Redis marked as unavailable
- 🔄 Reconnection loop starts

---

## Scenario 7: Redis Fails → Events Occur → Redis Reconnects

### Real-World Example: Redis Downtime with Recovery

#### Timeline:

```
Time 00:00 - ✅ Redis is UP, useRedis = true
Time 00:05 - ❌ Redis CRASHES (server restart, network issue, etc.)
           - "error" event fires
           - useRedis = false
           - startRedisReconnectLoop() begins

Time 00:06 - 📨 Event #1 occurs (Payment failed - needs refund)
           - add() called
           - useRedis is FALSE
           - Goes to: addToInMemory(event)
           - Event #1 → in-memory queue ✅
           - Logs: "Added critical event to in-memory queue. Queue size: 1"

Time 00:07 - 📨 Event #2 occurs (Database timeout - needs retry)
           - add() called
           - useRedis is FALSE
           - Event #2 → in-memory queue ✅
           - Logs: "Queue size: 2"

Time 00:08 - 📨 Event #3 occurs (External API error - needs notification)
           - Event #3 → in-memory queue ✅
           - Logs: "Queue size: 3"

Time 00:09 - 📨 Event #4 occurs (Concurrency error - needs reconciliation)
           - Event #4 → in-memory queue ✅
           - Logs: "Queue size: 4"

Time 00:10 - 📨 Event #5 occurs (Payment gateway timeout - needs retry)
           - Event #5 → in-memory queue ✅
           - Logs: "Queue size: 5"

Time 00:15 - ⏰ Reconnection attempt #1
           - redis.ping() called
           - Redis still down → FAILS
           - Logs: "Redis reconnection attempt failed"
           - Wait 10 more seconds...

Time 00:15 - ✅ Redis COMES BACK ONLINE
           - Next ping succeeds!
           - useRedis = true
           - clearRedisReconnectInterval() stops loop
           - processQueue() called
           - Logs: "Redis reconnected successfully!"

Time 00:15 - 🔄 Processing begins
           - processQueue() reads from in-memory (Redis queue is empty)
           - Event #1 processed → Success
           - Event #2 processed → Success
           - Event #3 processed → Success
           - Event #4 processed → Success
           - Event #5 processed → Success
           - Logs: "Successfully processed critical event: PaymentErrorEvent"

Time 00:16 - ✅ All events processed
           - In-memory queue size: 0
           - New events now go to Redis (persistent)
```

### What Happened to the 5 Events?

**Answer: ALL 5 events are SAFE and processed! ✅**

#### Why They're Safe:

1. **Stored in memory during downtime** - No writes attempted to dead Redis
2. **Processed immediately** - processQueue() runs continuously
3. **Not lost** - In-memory queue holds them until processed
4. **After Redis reconnects** - Future events go to Redis for persistence

### Code Flow Analysis:

```typescript
// DURING REDIS DOWNTIME (00:06 - 00:15)
async add(event: ErrorEvent): Promise<void> {
  if (this.useRedis && this.redis) {
    // SKIPPED (useRedis = false)
  } else {
    this.addToInMemory(event); // ← ALL 5 events go HERE
  }

  // Trigger processing immediately
  if (!this.isProcessing) {
    this.processQueue(); // ← Starts processing from in-memory
  }
}

// PROCESSING QUEUE (00:06 - 00:16)
private async processQueue() {
  while (true) {
    let event: ErrorEvent | null = null;

    // 1. Try Redis first (skipped because useRedis = false)
    if (this.useRedis && this.redis) {
      // SKIPPED during downtime
    }

    // 2. Get from in-memory queue ← THIS GETS ALL 5 EVENTS
    if (!event && this.queue.length > 0) {
      event = this.queue.shift(); // ← Pop event #1, #2, #3, #4, #5
    }

    if (!event) break; // All processed

    await this.processEventWithRetry(event); // ← Execute handlers
  }
}

// AFTER REDIS RECONNECTS (00:15)
this.redis?.ping().then(() => {
  this.useRedis = true; // ← Back to Redis mode
  this.clearRedisReconnectInterval(); // ← Stop reconnection loop
  this.processQueue(); // ← Process any remaining in-memory items
});
```

### Key Observations:

1. **No data loss** - All 5 events processed successfully
2. **Processing during downtime** - Events processed from in-memory queue
3. **Seamless transition** - When Redis reconnects, new events use Redis
4. **In-memory events NOT copied to Redis** - They stay in memory, get processed
5. **Future events persistent** - After reconnection, durability restored

### User Experience:

- ✅ Zero downtime for error handling
- ✅ All critical actions executed (refunds, notifications, etc.)
- ✅ Automatic recovery when Redis available
- ⚠️ Events in memory during downtime (risk if app crashes)
- 🔄 No manual intervention needed

---

## Scenario 8: Redis Fails and NEVER Reconnects

### Real-World Example: Permanent Redis Failure

#### Timeline:

```
Time 00:00 - ✅ Redis is UP, useRedis = true
Time 00:05 - ❌ Redis CRASHES and stays down permanently
           - "error" event fires
           - useRedis = false
           - startRedisReconnectLoop() begins

Time 00:06 - 📨 Event #1 occurs → in-memory queue ✅
Time 00:07 - 📨 Event #2 occurs → in-memory queue ✅
Time 00:08 - 📨 Event #3 occurs → in-memory queue ✅
Time 00:09 - 📨 Event #4 occurs → in-memory queue ✅
Time 00:10 - 📨 Event #5 occurs → in-memory queue ✅

Time 00:15 - ⏰ Reconnection attempt #1 → FAILS (Redis still down)
           - Logs: "Redis reconnection attempt failed"

Time 00:25 - ⏰ Reconnection attempt #2 → FAILS
Time 00:35 - ⏰ Reconnection attempt #3 → FAILS
Time 00:45 - ⏰ Reconnection attempt #4 → FAILS
Time 00:55 - ⏰ Reconnection attempt #5 → FAILS
... (continues every 10 seconds forever)

Time 01:00 - 📨 Event #6 occurs → in-memory queue ✅
Time 02:00 - 📨 Event #7 occurs → in-memory queue ✅
Time 03:00 - 📨 Event #8 occurs → in-memory queue ✅
... (app keeps running, queue processes events)

Time ∞ - Redis NEVER comes back
```

### What Happens?

**Answer: App continues working perfectly! ✅**

#### System Behavior:

1. **All events queued in-memory** - No dependency on Redis
2. **Events processed immediately** - Handlers execute normally
3. **Reconnection loop runs forever** - But doesn't block anything
4. **App operates in "degraded mode"** - No persistence, but functional

### Code Flow:

```typescript
// EVERY EVENT (00:06 onwards, forever)
async add(event: ErrorEvent): Promise<void> {
  if (this.useRedis && this.redis) {
    // NEVER EXECUTED (useRedis permanently false)
  } else {
    this.addToInMemory(event); // ← ALL events forever go here
  }

  if (!this.isProcessing) {
    this.processQueue(); // ← Process immediately from memory
  }
}

// PROCESSING (continuous)
private async processQueue() {
  while (true) {
    let event: ErrorEvent | null = null;

    // 1. Redis check (skipped forever)
    if (this.useRedis && this.redis) {
      // NEVER EXECUTED
    }

    // 2. In-memory processing ← THIS ALWAYS HAPPENS
    if (!event && this.queue.length > 0) {
      event = this.queue.shift(); // ← Process all events
    }

    if (!event) break;

    await this.processEventWithRetry(event); // ← Handlers execute
  }
}

// RECONNECTION (every 10 seconds, forever)
setInterval(() => {
  this.redis?.ping()
    .then(() => {
      // NEVER CALLED (Redis is down)
    })
    .catch((err) => {
      // Always logs this error
      this.logger.debug("Redis reconnection attempt failed", err.message);
    });
}, 10000);
```

### The Good News ✅

| Aspect                    | Status     | Description                             |
| ------------------------- | ---------- | --------------------------------------- |
| **App Uptime**            | ✅ Working | Doesn't crash, runs normally            |
| **Event Processing**      | ✅ Working | All handlers execute                    |
| **Error Handling**        | ✅ Working | Refunds, notifications, etc. all work   |
| **Performance**           | ✅ Good    | In-memory is actually faster than Redis |
| **Reconnection Overhead** | ✅ Minimal | One ping every 10s (negligible)         |

### The Bad News ⚠️

| Aspect              | Risk          | Impact                               |
| ------------------- | ------------- | ------------------------------------ |
| **Persistence**     | ❌ Lost       | Events not durable                   |
| **App Restart**     | 🔴 CRITICAL   | All in-memory events lost            |
| **Multi-Instance**  | ❌ No sharing | Can't distribute queue               |
| **Memory Growth**   | ⚠️ Possible   | If events come faster than processed |
| **Production Risk** | 🔴 HIGH       | Single point of failure              |

### Critical Risk: App Restart During Redis Downtime

```
Time 00:00 - Redis down, in-memory queue has 100 pending events
Time 00:01 - App CRASHES or K8s pod RESTARTS
Time 00:02 - App starts up
Time 00:03 - ❌ ALL 100 in-memory events are PERMANENTLY LOST
```

**This is the ONLY scenario where data is permanently lost:**

- ✅ Redis is down (events go to in-memory)
- ✅ App crashes/restarts before processing them
- ❌ Events are gone forever (no recovery possible)

### Impact by System Type:

#### Low-Traffic System:

```
Event Rate: 10 per hour
Processing Speed: < 1 second per event
Queue Size: Usually 0-1 items
Risk Level: 🟢 LOW
Reason: Events processed immediately, minimal exposure
```

#### Medium-Traffic System:

```
Event Rate: 100 per hour
Processing Speed: 2-5 seconds per event
Queue Size: Usually 2-10 items
Risk Level: 🟡 MEDIUM
Reason: Small queue, low probability of loss during restart
```

#### High-Traffic System:

```
Event Rate: 1000+ per hour
Processing Speed: 5-10 seconds per event
Queue Size: Can grow to 50-100+ items
Risk Level: 🔴 HIGH
Reason: Large queue accumulates, high loss risk on restart
```

### Memory Growth Scenario:

```
If events come FASTER than they're processed:

Time 00:00 - Queue size: 0
Time 01:00 - Queue size: 50  (processing 10/hr, receiving 60/hr)
Time 02:00 - Queue size: 100 (backlog growing)
Time 03:00 - Queue size: 150
Time 04:00 - Queue size: 200
... (continues until memory exhausted or app crashes)

Eventually:
- Out of Memory (OOM) error
- App crashes
- ALL queued events lost
```

### Monitoring & Alerting:

```typescript
// What you should monitor:

// 1. Redis connection status
if (!this.useRedis) {
  // CRITICAL ALERT
  alert('Redis unavailable for X minutes, using in-memory fallback');
}

// 2. In-memory queue size
if (this.queue.length > 100) {
  // WARNING ALERT
  alert(`In-memory queue growing: ${this.queue.length} items`);
}

// 3. Queue growth rate
if (queueGrowthRate > 10 per minute) {
  // ERROR ALERT
  alert('Queue backlog increasing, processing may be overwhelmed');
}

// 4. Reconnection failures
if (reconnectionFailuresCount > 30) {
  // CRITICAL ALERT (5 minutes of failures)
  alert('Redis unreachable for 5+ minutes, consider manual intervention');
}
```

### User Experience:

**For End Users:**

- ✅ No visible impact
- ✅ All critical actions executed (refunds, notifications)
- ✅ System appears to work normally

**For Operations Team:**

- ⚠️ Degraded mode active
- 🔴 High risk of data loss on restart
- 📊 Need to monitor queue size
- 🚨 Need to restore Redis ASAP

---

## Summary: What Happens If Redis Failed?

| Scenario                         | What Happens                              | Data Loss                | Recovery                              |
| -------------------------------- | ----------------------------------------- | ------------------------ | ------------------------------------- |
| **Startup failure**              | useRedis = false, in-memory only          | No (uses in-memory)      | Auto reconnect every 10s              |
| **Connection breaks mid-run**    | useRedis = false, fallback to in-memory   | Items in Redis queue     | Auto reconnect, resume from in-memory |
| **Read error during processing** | useRedis = false, continue with in-memory | Items in Redis queue     | Auto reconnect                        |
| **Write error during add**       | Item added to in-memory instead           | No (added to fallback)   | Auto reconnect                        |
| **Redis comes back online**      | useRedis = true, resume processing        | Recovered from in-memory | Zero manual action                    |
| **App shutdown**                 | Graceful close of Redis                   | In-memory items lost     | N/A (app stopping)                    |

---

## Reconnection Logic

### Interval Settings:

```typescript
private readonly REDIS_RECONNECT_INTERVAL = 10000; // 10 seconds
```

### Reconnection Loop:

```
Every 10 seconds:
  IF useRedis is false AND redis client exists:
    Try: redis.ping()
    IF success:
      useRedis = true
      Stop reconnection loop
      Resume processing queue
    ELSE:
      Log failure
      Wait 10 more seconds
      Try again
```

### Advantages:

- ✅ Non-blocking (doesn't freeze app)
- ✅ Configurable interval (can adjust 10s)
- ✅ Automatic recovery when Redis comes back
- ✅ No manual intervention needed

### Disadvantages:

- ⚠️ Up to 10 second delay to detect recovery
- ⚠️ Slightly higher CPU from periodic pings
- ⚠️ No items in Redis queue are recovered

---

## Data Loss Prevention & Mitigation Strategies

### Current Implementation:

```
Redis + In-Memory Hybrid
├── Primary: Redis (durable, persistent)
├── Fallback: In-Memory (temporary, lost on shutdown)
└── Risk: Items in Redis queue lost if Redis crashes
```

---

### Strategy 1: **Alert When Redis is Down**

```typescript
// In startRedisReconnectLoop()
private startRedisReconnectLoop() {
  if (this.redisReconnectInterval) {
    return;
  }

  let failureCount = 0;

  this.redisReconnectInterval = setInterval(() => {
    if (!this.useRedis && this.redis) {
      failureCount++;

      // Alert after 5 minutes (30 attempts * 10 seconds)
      if (failureCount === 30) {
        this.logger.error('CRITICAL: Redis unavailable for 5 minutes, using in-memory queue');
        // Send to monitoring system (Sentry, PagerDuty, etc.)
        this.errorTrackingService?.trackCriticalAlert({
          message: 'Redis unavailable for Error Action Queue',
          duration: '5 minutes',
          queueSize: this.queue.length,
        });
      }

      this.redis?.ping()
        .then(() => {
          this.logger.log('Redis reconnected successfully!');
          this.useRedis = true;
          failureCount = 0; // Reset counter
          this.clearRedisReconnectInterval();
          this.processQueue();
        })
        .catch((err) => {
          this.logger.debug(`Redis reconnection attempt ${failureCount} failed`);
        });
    }
  }, this.REDIS_RECONNECT_INTERVAL);
}
```

**Benefits:**

- ✅ Ops team notified of Redis downtime
- ✅ Can trigger manual intervention
- ✅ Integrates with existing monitoring

---

### Strategy 2: **Limit In-Memory Queue Size**

```typescript
export class ErrorActionQueue implements OnModuleInit, OnModuleDestroy {
  private readonly MAX_IN_MEMORY_QUEUE = 1000;
  private readonly queue: ErrorEvent[] = [];

  private addToInMemory(event: ErrorEvent) {
    if (this.queue.length >= this.MAX_IN_MEMORY_QUEUE) {
      this.logger.error(
        `In-memory queue full (${this.MAX_IN_MEMORY_QUEUE} items)! Cannot add event: ${event.constructor.name}`,
      );

      // Option A: Drop event (with alert)
      this.errorTrackingService?.trackCriticalAlert({
        message: "Error Action Queue full - event dropped",
        eventType: event.constructor.name,
        queueSize: this.queue.length,
      });

      return; // Event is lost, but app doesn't crash
    }

    this.queue.push(event);

    // Warn when queue is getting full
    if (this.queue.length > this.MAX_IN_MEMORY_QUEUE * 0.8) {
      this.logger.warn(
        `In-memory queue is ${(
          (this.queue.length / this.MAX_IN_MEMORY_QUEUE) *
          100
        ).toFixed(0)}% full (${this.queue.length} items)`,
      );
    }
  }
}
```

**Benefits:**

- ✅ Prevents out-of-memory crashes
- ✅ Controlled degradation
- ⚠️ May lose events if queue full

**Drawbacks:**

- ❌ Events are dropped when limit reached
- ❌ Need to choose appropriate limit

---

### Strategy 3: **Emergency Backup to MongoDB**

```typescript
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

interface EmergencyQueueItem {
  eventType: string;
  eventData: any;
  timestamp: Date;
  processed: boolean;
}

export class ErrorActionQueue implements OnModuleInit, OnModuleDestroy {
  private readonly MAX_IN_MEMORY_BEFORE_BACKUP = 100;
  private emergencyBackupInProgress = false;

  constructor(
    @InjectModel("EmergencyQueue")
    private emergencyQueueModel?: Model<EmergencyQueueItem>,
  ) {}

  private addToInMemory(event: ErrorEvent) {
    this.queue.push(event);
    this.logger.log(`Queue size: ${this.queue.length}`);

    // Emergency backup when queue grows too large
    if (
      this.queue.length > this.MAX_IN_MEMORY_BEFORE_BACKUP &&
      !this.useRedis &&
      !this.emergencyBackupInProgress
    ) {
      this.backupQueueToMongoDB().catch((err) => {
        this.logger.error("Failed to backup queue to MongoDB", err);
      });
    }
  }

  /**
   * Backup in-memory queue to MongoDB as emergency DLQ
   */
  private async backupQueueToMongoDB(): Promise<void> {
    if (!this.emergencyQueueModel) {
      this.logger.warn(
        "Emergency backup not configured (MongoDB model missing)",
      );
      return;
    }

    this.emergencyBackupInProgress = true;

    try {
      const itemsToBackup = this.queue.map((event) => ({
        eventType: event.constructor.name,
        eventData: JSON.stringify({
          type: event.constructor.name,
          data: event,
        }),
        timestamp: new Date(),
        processed: false,
      }));

      await this.emergencyQueueModel.insertMany(itemsToBackup);

      this.logger.log(
        `✅ Emergency backup: Saved ${itemsToBackup.length} events to MongoDB`,
      );

      // Alert ops team
      this.errorTrackingService?.trackCriticalAlert({
        message: "Emergency queue backup to MongoDB",
        eventCount: itemsToBackup.length,
        reason: "Redis unavailable and queue growing",
      });
    } catch (error) {
      this.logger.error("Failed to backup queue to MongoDB", error);
    } finally {
      this.emergencyBackupInProgress = false;
    }
  }

  /**
   * Restore from MongoDB backup on startup if Redis is down
   */
  async onModuleInit() {
    if (!this.useRedis && this.emergencyQueueModel) {
      await this.restoreFromMongoDB();
    }

    this.processQueue();
  }

  private async restoreFromMongoDB(): Promise<void> {
    try {
      const unprocessedEvents = await this.emergencyQueueModel
        .find({ processed: false })
        .sort({ timestamp: 1 })
        .exec();

      if (unprocessedEvents.length > 0) {
        this.logger.log(
          `📦 Restoring ${unprocessedEvents.length} events from MongoDB emergency backup`,
        );

        for (const item of unprocessedEvents) {
          const parsed = JSON.parse(item.eventData);
          const event = this.reconstructEvent(parsed);
          this.queue.push(event);

          // Mark as processed
          await this.emergencyQueueModel.updateOne(
            { _id: item._id },
            { processed: true },
          );
        }

        this.logger.log("✅ Emergency backup restored successfully");
      }
    } catch (error) {
      this.logger.error("Failed to restore from MongoDB backup", error);
    }
  }
}
```

**Benefits:**

- ✅ No data loss even if app restarts
- ✅ Events persisted to durable storage
- ✅ Can restore after app crashes

**Drawbacks:**

- ⚠️ Additional complexity
- ⚠️ MongoDB must be available
- ⚠️ Performance overhead

---

### Strategy 4: **Migrate In-Memory to Redis on Reconnect**

```typescript
private startRedisReconnectLoop() {
  this.redisReconnectInterval = setInterval(() => {
    if (!this.useRedis && this.redis) {
      this.redis?.ping()
        .then(async () => {
          this.logger.log('Redis reconnected successfully!');

          // Migrate in-memory events to Redis for durability
          await this.migrateInMemoryToRedis();

          this.useRedis = true;
          this.clearRedisReconnectInterval();
          this.processQueue();
        })
        .catch((err) => {
          this.logger.debug("Redis reconnection attempt failed", err.message);
        });
    }
  }, this.REDIS_RECONNECT_INTERVAL);
}

/**
 * Migrate in-memory queue items to Redis when it reconnects
 */
private async migrateInMemoryToRedis(): Promise<void> {
  if (this.queue.length === 0) return;

  this.logger.log(
    `🔄 Migrating ${this.queue.length} in-memory events to Redis...`,
  );

  try {
    const itemsToMigrate = [...this.queue]; // Copy queue

    for (const event of itemsToMigrate) {
      const payload = JSON.stringify({
        type: event.constructor.name,
        data: event,
      });

      await this.redis?.rpush(this.REDIS_KEY, payload);
    }

    this.logger.log(
      `✅ Successfully migrated ${itemsToMigrate.length} events to Redis`,
    );

    // Events are now in Redis, but keep in memory for processing
    // They'll be processed from memory, and won't be re-read from Redis

  } catch (error) {
    this.logger.error('Failed to migrate events to Redis', error);
    // Keep events in memory if migration fails
  }
}
```

**Benefits:**

- ✅ Events become persistent after Redis reconnects
- ✅ Protected from app restarts after migration
- ✅ No external dependencies

**Drawbacks:**

- ⚠️ Duplication possible if migration fails mid-way
- ⚠️ Events processed from memory, not Redis (after migration)

---

### Strategy 5: **Health Check Endpoint**

```typescript
// In admin.controller.ts or health.controller.ts

@Get('/health/queue')
getQueueHealth() {
  return {
    redis: {
      connected: this.errorActionQueue.isRedisConnected(),
      status: this.errorActionQueue.isRedisConnected() ? 'healthy' : 'degraded',
    },
    queue: {
      size: this.errorActionQueue.getQueueSize(),
      mode: this.errorActionQueue.isRedisConnected() ? 'redis' : 'in-memory',
      warning: this.errorActionQueue.getQueueSize() > 100,
    },
    timestamp: new Date().toISOString(),
  };
}

// In ErrorActionQueue class:
public isRedisConnected(): boolean {
  return this.useRedis;
}

public getQueueSize(): number {
  return this.queue.length;
}
```

**Benefits:**

- ✅ K8s liveness/readiness probes
- ✅ External monitoring integration
- ✅ Quick status check

---

### Strategy 6: **Redis Persistence Configuration**

```bash
# In Redis configuration (redis.conf):
save 900 1        # Save every 15 minutes if 1 key changed
save 300 10       # Save every 5 minutes if 10 keys changed
save 60 10000     # Save every 1 minute if 10000 keys changed
appendonly yes    # Enable AOF for durability
appendfsync everysec  # Sync every second (good balance)
```

**Benefits:**

- ✅ Redis data survives Redis restarts
- ✅ No code changes needed
- ✅ Standard Redis feature

---

### Recommended Strategy: **Layered Defense**

Combine multiple strategies for production:

```typescript
export class ErrorActionQueue implements OnModuleInit, OnModuleDestroy {
  // Layer 1: Limit queue size
  private readonly MAX_IN_MEMORY_QUEUE = 1000;

  // Layer 2: Backup threshold
  private readonly MAX_IN_MEMORY_BEFORE_BACKUP = 100;

  // Layer 3: Alert threshold
  private readonly ALERT_AFTER_FAILURES = 30; // 5 minutes

  private addToInMemory(event: ErrorEvent) {
    // Check limit
    if (this.queue.length >= this.MAX_IN_MEMORY_QUEUE) {
      this.handleQueueFull(event);
      return;
    }

    this.queue.push(event);

    // Trigger backup if queue growing
    if (
      this.queue.length > this.MAX_IN_MEMORY_BEFORE_BACKUP &&
      !this.useRedis
    ) {
      this.backupQueueToMongoDB();
    }

    // Warn if queue is large
    if (this.queue.length > 500) {
      this.logger.warn(`Queue size critical: ${this.queue.length} items`);
    }
  }

  private handleQueueFull(event: ErrorEvent) {
    // Try to save to MongoDB
    if (this.emergencyQueueModel) {
      this.saveToMongoDBDirectly(event);
    } else {
      // Last resort: log and alert
      this.logger.error("Queue full and no backup available - event lost");
      this.errorTrackingService?.trackCriticalAlert({
        message: "Error Action Queue full - event dropped",
        eventType: event.constructor.name,
      });
    }
  }
}
```

**This provides:**

1. ✅ **Queue size limit** - Prevents OOM
2. ✅ **MongoDB backup** - Durability insurance
3. ✅ **Alerts** - Ops team notification
4. ✅ **Health checks** - Monitoring integration
5. ✅ **Graceful degradation** - No crashes

---

## Monitoring & Alerting

### What to Monitor:

```typescript
// 1. Redis connection status
if (!this.useRedis) {
  alert('Redis unavailable, using in-memory queue');
}

// 2. In-memory queue size
if (this.queue.length > 1000) {
  alert('In-memory queue growing, Redis might be down');
}

// 3. Reconnection attempts
// Log every reconnection failure

// 4. Admin endpoint for status
GET /admin/error-actions/status
{
  "pending": 5,
  "running": 2,
  "completed": 150,
  "failed": 3,
  "criticalPending": [...]
}
```

### Alert Rules:

```
1. IF useRedis = false for > 5 minutes
   → CRITICAL: Redis is down, using in-memory fallback

2. IF queue.length > 1000 items
   → WARNING: Queue backlog detected

3. IF failed count increases rapidly
   → ERROR: Handler errors increasing
```

---

## Testing Redis Failures

### Simulate Redis Crash:

```bash
# 1. Kill Redis container
docker-compose kill redis

# 2. Watch logs
# Should see: "Redis error in Error Action Queue"
# Should see: "Attempting to reconnect..."

# 3. Trigger error
# Should queue in memory

# 4. Restart Redis
docker-compose up redis

# 5. Watch logs
# Should see: "Redis reconnected successfully!"
# Should see: Processing resumed
```

### Test In-Memory Fallback:

```bash
# 1. Set REDIS_HOST to invalid address
export REDIS_HOST=127.0.0.1:9999

# 2. Start app
npm run start

# 3. Check logs
# Should see: "Failed to initialize Redis client, using in-memory queue"

# 4. Trigger errors
# Should queue in memory and process normally
```

---

## Best Practices

1. **Always assume Redis can fail** - Design with fallback
2. **Monitor Redis health** - Use metrics dashboard
3. **Set up alerts** - For Redis down, queue growing
4. **Test failure scenarios** - Use chaos engineering
5. **Use persistence** - Enable Redis RDB/AOF
6. **Implement DLQ** - For permanently failed items
7. **Document runbooks** - For manual recovery if needed
8. **Adjust reconnection interval** - Based on your tolerance

---

## Configuration

### To Adjust Reconnection Interval:

```typescript
// Current: 10 seconds
private readonly REDIS_RECONNECT_INTERVAL = 10000;

// Change to 30 seconds for slower recovery acceptance:
private readonly REDIS_RECONNECT_INTERVAL = 30000;

// Change to 5 seconds for faster recovery:
private readonly REDIS_RECONNECT_INTERVAL = 5000;
```

### To Adjust Redis Connection Timeout:

```typescript
this.redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  connectTimeout: 10000, // Add timeout
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => {
    if (times > 5) {
      // Increase from 3 to 5
      return null;
    }
    return Math.min(times * 50, 2000);
  },
});
```

---

## Conclusion

**If Redis fails, the ErrorActionQueue will:**

1. ✅ Detect the failure immediately
2. ✅ Switch to in-memory queue
3. ✅ Continue processing errors
4. ✅ Attempt automatic reconnection every 10 seconds
5. ✅ Resume from Redis when it comes back
6. ⚠️ Potentially lose items that were only in Redis queue

**This is acceptable for non-critical systems, but production systems should:**

- Add monitoring and alerting
- Implement a persistent DLQ
- Enable Redis persistence
- Set up automated recovery procedures
