# Error Action Flow - Visual Diagram

## Complete Request-to-Response Flow with Error Actions

This document shows the complete flow from incoming request → error → actions → response.

---

## 📊 Visual Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. HTTP REQUEST                                                          │
│    POST /accounts/abc-123/deposit                                        │
│    Body: { "amount": 100 }                                               │
└────────────────────┬────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. CONTROLLER (AccountsController)                                       │
│    - Extracts accountId, amount from request                             │
│    - Creates DepositCommand                                              │
│    - Calls commandBus.execute()                                          │
│    ┌─────────────────────────────────────────────────────┐              │
│    │ @Post(':id/deposit')                                │              │
│    │ async deposit(@Param('id') id, @Body() dto) {       │              │
│    │   await this.commands.execute(                       │              │
│    │     new DepositCommand(id, dto.amount)               │              │
│    │   );                                                 │              │
│    │   return { accountId: id };                          │              │
│    │ }                                                    │              │
│    └─────────────────────────────────────────────────────┘              │
└────────────────────┬────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. COMMAND BUS                                                           │
│    - Routes command to DepositHandler                                    │
│    - No try/catch here                                                   │
└────────────────────┬────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. COMMAND HANDLER (DepositHandler)                                      │
│    - Loads account from repository                                       │
│    - Calls account.deposit(amount)                                       │
│    - Saves account                                                       │
│    ┌─────────────────────────────────────────────────────┐              │
│    │ async executeInternal(cmd: DepositCommand) {         │              │
│    │   const account = await this.repo.getById(cmd.id);   │              │
│    │   account.deposit(cmd.amount);  // ← ERROR HERE!    │              │
│    │   await this.repo.save(account);                     │              │
│    │ }                                                    │              │
│    └─────────────────────────────────────────────────────┘              │
└────────────────────┬────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. DOMAIN LOGIC (Account.deposit)                                        │
│    - Validates business rules                                            │
│    - Throws domain exception                                             │
│    ┌─────────────────────────────────────────────────────┐              │
│    │ deposit(amount: number) {                            │              │
│    │   if (this._balance < amount) {                      │              │
│    │     throw new InsufficientFundsError(...);  // ✗     │              │
│    │   }                                                  │              │
│    │   this.apply(new DepositedEvent(...));               │              │
│    │ }                                                    │              │
│    └─────────────────────────────────────────────────────┘              │
└────────────────────┬────────────────────────────────────────────────────┘
                     │
                     ▼ [Exception bubbles up through call stack]
                     │
                     │ Handler → Bus → Controller → NestJS
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 6. GLOBAL EXCEPTION FILTER (GlobalExceptionFilter.catch)                │
│    - Catches ALL exceptions                                              │
│    - Gets correlation ID                                                 │
│    - Determines HTTP status code                                         │
│    - Logs error                                                          │
│    - Records metrics                                                     │
│    - Publishes error event (fire-and-forget) ✨                          │
│    ┌─────────────────────────────────────────────────────┐              │
│    │ catch(exception: unknown, host: ArgumentsHost) {     │              │
│    │   const correlationId = getCorrelationId();          │              │
│    │   const errorResponse = this.handleException(...);   │              │
│    │                                                       │              │
│    │   // Log, track, metrics...                          │              │
│    │                                                       │              │
│    │   // 🚀 PUBLISH ERROR EVENT (async, fire-and-forget) │              │
│    │   if (exception instanceof BaseException) {          │              │
│    │     this.errorActionService.publishError(            │              │
│    │       exception,                                     │              │
│    │       { correlationId, userId, path, method, ... }   │              │
│    │     ).catch(() => {});  // Don't block response     │              │
│    │   }                                                  │              │
│    │                                                       │              │
│    │   // Send HTTP response immediately                  │              │
│    │   response.status(422).json(errorResponse);  // ✅   │              │
│    │ }                                                    │              │
│    └─────────────────────────────────────────────────────┘              │
└────────────────────┬────────────────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
┌──────────────────┐    ┌───────────────────────────────────────────────┐
│ 7A. HTTP RESPONSE│    │ 7B. ERROR ACTION PIPELINE (Background)        │
│ Sent to User     │    │ (Runs async, doesn't block response)          │
│                  │    │                                                │
│ Status: 422      │    │                                                │
│ Body: {          │    └──────────────────┬────────────────────────────┘
│   error: {       │                       │
│     code:        │                       ▼
│       "INSUFF..."│    ┌───────────────────────────────────────────────┐
│     message:     │    │ ERROR ACTION SERVICE                         │
│       "Insuffic.."│    │ (ErrorActionService.publishError)            │
│   },             │    │                                                │
│   correlationId: │    │ 1. Creates ErrorEvent from BaseException      │
│     "abc-123"    │    │ 2. Publishes to EventBus                      │
│ }                │    │                                                │
└──────────────────┘    │ ┌──────────────────────────────────────────┐ │
                        │ │ const event = new PaymentErrorEvent(...); │ │
        ✅ USER GETS    │ │ await eventBus.publish(event);            │ │
        RESPONSE FAST   │ └──────────────────────────────────────────┘ │
        (~50ms)         └──────────────────┬────────────────────────────┘
                                           │
                                           ▼
                        ┌───────────────────────────────────────────────┐
                        │ EVENT BUS                                     │
                        │ (EventBus.publish)                            │
                        │                                                │
                        │ - Finds all subscribers for 'PaymentErrorEvent'│
                        │ - Calls each subscriber sequentially           │
                        │ - Subscribers are registered by               │
                        │   ErrorActionService.onModuleInit()           │
                        │                                                │
                        │ Subscribers:                                  │
                        │   → ErrorActionService.handleErrorEvent()     │
                        └──────────────────┬────────────────────────────┘
                                           │
                                           ▼
                        ┌───────────────────────────────────────────────┐
                        │ ERROR ACTION SERVICE                         │
                        │ (ErrorActionService.handleErrorEvent)         │
                        │                                                │
                        │ 1. Filters registered handlers                │
                        │    (find handlers where canHandle(event))     │
                        │                                                │
                        │ 2a. **Critical events** → enqueued to         │
                        │     ErrorActionQueue (Redis durable,          │
                        │     in-memory fallback) and processed         │
                        │     sequentially with retries.                │
                        │                                                │
                        │ 2b. **Non-critical events** → executed        │
                        │     immediately in parallel                   │
                        │     (Promise.allSettled).                     │
                        │                                                │
                        │ Handlers that canHandle(event):               │
                        │   ✅ PaymentErrorHandler (critical → queue)   │
                        │   ✅ PaymentAuditHandler (non-critical)       │
                        └──────────────────┬────────────────────────────┘
                                           │
                    ┌──────────────────────┴──────────────────────┐
                    │                                             │
                    ▼                                             ▼
┌───────────────────────────────────────┐  ┌───────────────────────────────────────┐
│ PAYMENT ERROR HANDLER                 │  │ PAYMENT AUDIT HANDLER                 │
│ (PaymentErrorHandler.handle)          │  │ (PaymentAuditHandler.handle)          │
│                                       │  │                                       │
│ Executes in parallel:                 │  │ Executes:                             │
│ ┌─────────────────────────────────┐   │  │ ┌─────────────────────────────────┐   │
│ │ 1. Refund User                  │   │  │ │ Log to audit database           │   │
│ │    await refundService.refund({ │   │  │ │ await auditService.log({        │   │
│ │      paymentId: 'abc',          │   │  │ │   event: 'PAYMENT_FAILED',      │   │
│ │      amount: 100,               │   │  │ │   paymentId: 'abc',             │   │
│ │    });                          │   │  │ │ });                             │   │
│ └─────────────────────────────────┘   │  │ └─────────────────────────────────┘   │
│                                       │  │                                       │
│ ┌─────────────────────────────────┐   │  │                                       │
│ │ 2. Send Email                   │   │  │                                       │
│ │    await emailService.send({    │   │  │                                       │
│ │      to: userEmail,             │   │  │                                       │
│ │      template: 'payment-failed',│   │  │                                       │
│ │    });                          │   │  │                                       │
│ └─────────────────────────────────┘   │  │                                       │
│                                       │  │                                       │
│ ┌─────────────────────────────────┐   │  │                                       │
│ │ 3. Notify Ops (if high value)   │   │  │                                       │
│ │    if (amount > 10000) {        │   │  │                                       │
│ │      await alertService.alert();│   │  │                                       │
│ │    }                            │   │  │                                       │
│ └─────────────────────────────────┘   │  │                                       │
│                                       │  │                                       │
│ All actions run in parallel           │  │ Runs independently                    │
│ (Promise.allSettled)                  │  │                                       │
│                                       │  │                                       │
│ ⏱️  Total time: ~2-5 seconds          │  │ ⏱️  Total time: ~100ms                 │
│ (but user already got response!)      │  │ (but user already got response!)      │
└───────────────────────────────────────┘  └───────────────────────────────────────┘

✅ USER RESPONSE SENT IMMEDIATELY (~50ms)
   Background actions complete later (~2-5s)
```

---

## ⏱️ Timeline View

```
Time    │ What Happens
────────┼─────────────────────────────────────────────────────────────
0ms     │ User sends POST /accounts/abc-123/deposit
        │
10ms    │ Controller receives request
        │
20ms    │ CommandBus routes to DepositHandler
        │
30ms    │ Handler loads account from repository
        │
40ms    │ Domain logic: account.deposit(amount)
        │ ❌ Throws InsufficientFundsError
        │
50ms    │ Exception bubbles up (Handler → Bus → Controller)
        │
60ms    │ GlobalExceptionFilter catches exception
        │ - Creates error response
        │ - Logs error
        │ - Records metrics
        │ - Publishes error event (fire-and-forget) ✨
        │
70ms    │ ✅ HTTP Response sent to user (422 Unprocessable Entity)
        │ ✅ User sees error message
        │
        │ ───────────────────────────────────────────────────────────
        │ Background Actions (User doesn't wait for these)
        │ ───────────────────────────────────────────────────────────
        │
80ms    │ ErrorActionService creates PaymentErrorEvent
        │
90ms    │ EventBus publishes event to subscribers
        │
100ms   │ ErrorActionService.handleErrorEvent() called
        │ - Finds applicable handlers
        │ - Starts executing handlers in parallel
        │
200ms   │ PaymentErrorHandler starts:
        │ - Refund request sent to refund service (takes 2s)
        │ - Email sent to user (takes 500ms)
        │ - Ops notification (takes 100ms)
        │
700ms   │ ✅ Email sent
        │
800ms   │ ✅ Ops notified
        │
2200ms  │ ✅ Refund processed
        │
        │ All actions complete (but user already got response at 70ms!)
```

---

## 📈 Flow Summary Table

| Step | Component            | Time       | Blocking? | Description                      |
| ---- | -------------------- | ---------- | --------- | -------------------------------- |
| 1    | HTTP Request         | 0ms        | -         | User sends request               |
| 2    | Controller           | 10ms       | ✅        | Receives request                 |
| 3    | CommandBus           | 20ms       | ✅        | Routes command                   |
| 4    | Handler              | 30ms       | ✅        | Executes business logic          |
| 5    | Domain               | 40ms       | ✅        | Throws exception                 |
| 6    | Exception Filter     | 60ms       | ✅        | Catches, logs, publishes event   |
| 7    | **HTTP Response**    | **70ms**   | ✅        | **User gets response**           |
| 8    | Error Action Service | 80ms       | ❌        | Creates error event (background) |
| 9    | EventBus             | 90ms       | ❌        | Publishes event (background)     |
| 10   | Handler Execution    | 100-2200ms | ❌        | Actions run (background)         |
| 11   | Actions Complete     | 2200ms     | ❌        | All actions done                 |

**User experience**: Gets error response in **70ms**, actions complete in background over next **2 seconds**.

---

## 🎯 Key Timing Points

```
┌────────────────────────────────────────────────────────────┐
│ TIMELINE (not to scale)                                    │
└────────────────────────────────────────────────────────────┘

0ms         70ms          200ms         700ms         2200ms
│           │              │             │              │
├───────────┼──────────────┼─────────────┼──────────────┤
│ Request   │ Response     │ Handler     │ Email Sent   │ Refund Done
│ Arrives   │ Sent ✅      │ Starts      │ ✅           │ ✅
│           │              │             │              │
│           │              │             │              │
│ ═════════ User sees response ═══════════════════════════  │
│                                                           │
│                  Background Actions ────────────────────  │
│                  (User doesn't wait)                      │
└───────────────────────────────────────────────────────────┘
```

---

## 🔄 Complete Sequence Diagram

```
User          Controller    Handler      Domain      Filter         ActionService    EventBus    Handlers
 │                │           │            │           │                  │              │           │
 │ POST /deposit  │           │            │           │                  │              │           │
 ├───────────────>│           │            │           │                  │              │           │
 │                │ execute() │            │           │                  │              │           │
 │                ├──────────>│            │           │                  │              │           │
 │                │           │ getById()  │           │                  │              │           │
 │                │           ├───────────>│           │                  │              │           │
 │                │           │            │ deposit() │                  │              │           │
 │                │           │            ├──────────>│                  │              │           │
 │                │           │            │   ❌      │                  │              │           │
 │                │           │            │ Exception │                  │              │           │
 │                │           │            ├───────────┼──────────────────┼──────────────┼───────────┤
 │                │           │            │           │   catch()        │              │           │
 │                │           │            │           │                  │              │           │
 │                │           │            │           │ publishError()   │              │           │
 │                │           │            │           ├─────────────────>│              │           │
 │                │           │            │           │                  │ createEvent()│           │
 │                │           │            │           │                  ├──────────────>│           │
 │                │           │            │           │                  │              │ publish() │
 │                │           │            │           │                  │              ├──────────>│
 │                │           │            │           │                  │              │           │
 │                │           │            │           │ response.json()  │              │           │
 │                │           │            │           ├─────────────────────────────────────────────────>
 │  422 Response  │           │            │           │                  │              │           │
 │<───────────────┼───────────┼───────────┼───────────┼──────────────────┼──────────────┼───────────┤
 │ ✅ User sees   │           │           │           │                  │              │           │
 │    error       │           │           │           │                  │              │           │
 │                │           │           │           │                  │              │           │
 │                │           │           │           │                  │              │ handleEvent()
 │                │           │           │           │                  │              │<──────────┤
 │                │           │           │           │                  │              │           │
 │                │           │           │           │                  │              │ handler.handle()
 │                │           │           │           │                  │              ├──────────>│
 │                │           │           │           │                  │              │           │
 │                │           │           │           │                  │              │ refundUser()
 │                │           │           │           │                  │              │ sendEmail()
 │                │           │           │           │                  │              │ notifyOps()
 │                │           │           │           │                  │              │           │
 │                │           │           │           │                  │              │ ✅ Actions done
 │                │           │           │           │                  │              │<──────────┤
```

---

## 💡 Key Insights

### 1. **User Experience**

- ✅ Gets response in **~70ms** (fast!)
- ✅ Doesn't wait for refund/email (non-blocking)
- ✅ Clear error message with correlation ID

### 2. **Background Processing**

- ✅ All actions run **after** response sent
- ✅ Actions run **in parallel** (faster)
- ✅ Handler failures don't affect user response

### 3. **Error Flow**

```
Error thrown → Bubbles up → Filter catches → Response sent → Actions run
    40ms           50ms          60ms           70ms        80-2200ms
```

### 4. **Action Execution**

```
EventBus → ErrorActionService → Handlers → Actions
  90ms          100ms            200ms      200-2200ms
```

---

## 🔍 Example: Payment Failure Flow

### Scenario

User tries to deposit $100, but payment gateway fails.

```
1. Request: POST /payments { accountId: "abc", amount: 100 }

2. PaymentService.processPayment()
   → Calls external payment gateway
   → Gateway returns error
   → Throws PaymentGatewayError

3. Exception bubbles to GlobalExceptionFilter

4. Filter:
   ✅ Creates error response (502 Bad Gateway)
   ✅ Logs error
   ✅ Records metrics
   ✅ Publishes PaymentErrorEvent (fire-and-forget)
   ✅ Sends response to user (70ms)

5. Background (user already has response):
   → ErrorActionService creates PaymentErrorEvent
   → EventBus publishes event
   → PaymentErrorHandler.handle() executes:
      - Refunds user's account (+$100)
      - Sends "Payment failed" email
      - Logs to audit database
      - Notifies ops team (if amount > $10,000)

   All complete by ~2 seconds, but user got response at 70ms!
```

---

## 🎯 Response Times

| What                | Time   | Blocking?          |
| ------------------- | ------ | ------------------ |
| **User sees error** | 70ms   | ✅ Yes             |
| Email sent          | 700ms  | ❌ No (background) |
| Refund processed    | 2200ms | ❌ No (background) |
| Audit logged        | 800ms  | ❌ No (background) |

**User only waits 70ms** - everything else happens in background!

---

## 🚨 Error Scenarios

### Scenario 1: Handler Fails

```
PaymentErrorHandler.handle()
  → refundUser() succeeds ✅
  → sendEmail() fails ❌ (email service down)
  → notifyOps() succeeds ✅

Result:
  ✅ User got response (70ms)
  ✅ Refund processed
  ❌ Email failed (logged, can retry later)
  ✅ Ops notified
```

**User doesn't know email failed** - handler errors are logged but don't affect response.

---

### Scenario 2: App Crashes After Response

```
70ms: Response sent ✅
80ms: ErrorActionService enqueues critical event (Redis) or marks for immediate run (non-critical)
100ms: Queue worker dequeues critical event and starts handler (sequential)
250ms: App crashes ❌

Result (critical + Redis available):
        ✅ User got response
        ✅ Event persisted; processed on restart with retries

Result (critical but on in-memory fallback):
        ✅ User got response
        ⚠️ Event lost if process dies before retry (best-effort while degraded)

Result (non-critical):
        ✅ User got response
        ⚠️ In-flight work lost on crash (best-effort by design)
```

**Mitigation**: Keep Redis healthy to retain durability; add DLQ/metrics for production resilience.

---

### Scenario 3: High Error Rate

```
Database down
→ 10,000 requests fail
→ 10,000 error events published
→ 10,000 handlers execute simultaneously
→ Email service overwhelmed ❌
```

**Mitigation**: Add throttling/rate limiting to handlers.

---

## Summary

**Main Flow** (User-facing):

```
Request → Controller → Handler → Domain → Exception → Filter → Response ✅
                                                                   (70ms)
```

**Background Flow** (Error Actions):

```
Filter → ErrorActionService → EventBus → Handlers → Actions ✅
                                                            (2-5s)
```

**Key Point**: User gets response in **70ms**, actions run in background over next **2-5 seconds**!
