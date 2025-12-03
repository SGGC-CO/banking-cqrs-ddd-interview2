# Testing Sentry and Prometheus Integration

This guide shows how to test the Sentry error tracking and Prometheus metrics integrations.

---

## 📦 Step 1: Install Optional Dependencies

Both Sentry and Prometheus are optional - the app works without them but falls back to logging.

### Install Sentry (Optional)
```bash
npm install @sentry/node
```

### Install Prometheus Client (Optional)
```bash
npm install prom-client
```

---

## 🧪 Step 2: Testing Prometheus Metrics

### 2.1 Start the Application
```bash
npm run start:dev
```

### 2.2 Trigger Some Errors

#### Test 1: Validation Error
```bash
curl -X POST http://localhost:3000/accounts/test-123/deposit \
  -H "Content-Type: application/json" \
  -d '{"amount": -100}'
```

#### Test 2: Insufficient Funds Error
```bash
# First, open an account
curl -X POST http://localhost:3000/accounts/test-456/open \
  -H "Content-Type: application/json" \
  -d '{"ownerId": "user-1", "currency": "USD", "initialBalance": 50}'

# Then try to withdraw more than available
curl -X POST http://localhost:3000/accounts/test-456/withdraw \
  -H "Content-Type: application/json" \
  -d '{"amount": 200}'
```

#### Test 3: Not Found Error
```bash
curl http://localhost:3000/accounts/non-existent-account
```

#### Test 4: Server Error (Circuit Breaker)
```bash
# Stop MongoDB, then try to deposit
curl -X POST http://localhost:3000/accounts/test-456/deposit \
  -H "Content-Type: application/json" \
  -d '{"amount": 100}'
```

### 2.3 Check Prometheus Metrics

#### Option A: Via Admin Endpoint (if prom-client installed)
```bash
curl http://localhost:3000/admin/metrics
```

**Expected Output:**
```
# HELP http_errors_total Total number of HTTP errors
# TYPE http_errors_total counter
http_errors_total{method="POST",path="/accounts/:id/deposit",status_code="400",error_code="VALIDATION_ERROR"} 1
http_errors_total{method="POST",path="/accounts/:id/withdraw",status_code="422",error_code="INSUFFICIENT_FUNDS"} 1
http_errors_total{method="GET",path="/accounts/:id",status_code="404",error_code="ACCOUNT_NOT_FOUND"} 1

# HELP error_response_duration_seconds Error response duration in seconds
# TYPE error_response_duration_seconds histogram
error_response_duration_seconds_bucket{error_code="VALIDATION_ERROR",le="0.01"} 1
...
```

#### Option B: Check Application Logs (if prom-client not installed)
The metrics will be logged to console with `debug` level:
```json
{
  "metric": "error",
  "method": "POST",
  "path": "/accounts/:id/deposit",
  "statusCode": 400,
  "errorCode": "VALIDATION_ERROR",
  "durationMs": 15
}
```

### 2.4 Verify Metrics Are Working

✅ **Success Indicators:**
- Metrics endpoint returns Prometheus-formatted metrics
- Error counts increase for each error type
- Paths are normalized (IDs replaced with `:id`)
- Duration histograms are recorded

❌ **If Not Working:**
- Check if `prom-client` is installed: `npm list prom-client`
- Check application logs for "Prometheus metrics initialized"
- Verify errors are being triggered (check response status codes)

---

## 🔍 Step 3: Testing Sentry Error Tracking

### 3.1 Set Up Sentry Account

1. Go to [sentry.io](https://sentry.io) and create a free account
2. Create a new project (Node.js)
3. Copy your DSN (looks like: `https://xxx@xxx.ingest.sentry.io/xxx`)

### 3.2 Configure Sentry DSN

#### Option A: Environment Variable
```bash
# Windows PowerShell
$env:SENTRY_DSN="https://your-dsn-here@sentry.io/your-project-id"

# Linux/Mac
export SENTRY_DSN="https://your-dsn-here@sentry.io/your-project-id"
```

#### Option B: Create `.env` file (if using dotenv)
```env
SENTRY_DSN=https://your-dsn-here@sentry.io/your-project-id
NODE_ENV=development
```

### 3.3 Start Application with Sentry
```bash
npm run start:dev
```

**Expected Log:**
```
[Sentry] Sentry error tracking initialized
```

### 3.4 Trigger Non-Operational Errors

**Important:** Sentry only tracks **non-operational errors** (unexpected bugs, not business rule violations).

#### Test 1: Internal Server Error (Should be tracked)
```bash
# This will trigger a 500 error if handler not found
curl -X POST http://localhost:3000/accounts/test/unknown-command \
  -H "Content-Type: application/json" \
  -d '{}'
```

#### Test 2: Database Connection Error (Should be tracked)
```bash
# Stop MongoDB, then make a request
curl http://localhost:3000/accounts/test-123
```

#### Test 3: Business Rule Violation (Should NOT be tracked)
```bash
# These are operational errors - Sentry will ignore them
curl -X POST http://localhost:3000/accounts/test-456/withdraw \
  -H "Content-Type: application/json" \
  -d '{"amount": 200}'  # Insufficient funds

curl http://localhost:3000/accounts/non-existent  # Not found
```

### 3.5 Verify Errors in Sentry Dashboard

1. Go to your Sentry project dashboard
2. Navigate to **Issues** tab
3. You should see errors appear within a few seconds

**What You Should See:**
- ✅ Internal server errors
- ✅ Database connection errors
- ✅ Circuit breaker errors
- ❌ Validation errors (filtered out - operational)
- ❌ Insufficient funds (filtered out - operational)
- ❌ Not found errors (filtered out - operational)

### 3.6 Check Error Details in Sentry

Click on an error to see:
- **Correlation ID** in tags
- **Error code** in tags
- **Request path and method** in context
- **Stack trace** for debugging
- **User agent** and **IP address**

### 3.7 Verify Correlation IDs

Each error includes a correlation ID. Check the response headers:
```bash
curl -v http://localhost:3000/accounts/test-123 2>&1 | grep -i correlation
```

The correlation ID should match the one in Sentry tags.

---

## 🧪 Step 4: Manual Testing Script

Create a test script to trigger various errors:

### 4.1 Create Test Script

**File:** `scripts/test-monitoring.sh` (Linux/Mac) or `scripts/test-monitoring.ps1` (Windows)

```bash
#!/bin/bash
# test-monitoring.sh

BASE_URL="http://localhost:3000"

echo "🧪 Testing Error Tracking and Metrics"
echo "====================================="
echo ""

# Test 1: Validation Error (Operational - should NOT go to Sentry)
echo "1. Testing validation error..."
curl -X POST "$BASE_URL/accounts/test/deposit" \
  -H "Content-Type: application/json" \
  -d '{"amount": -100}' \
  -w "\nStatus: %{http_code}\n" \
  -s | jq .
echo ""

# Test 2: Not Found (Operational - should NOT go to Sentry)
echo "2. Testing not found error..."
curl "$BASE_URL/accounts/non-existent-account" \
  -w "\nStatus: %{http_code}\n" \
  -s | jq .
echo ""

# Test 3: Insufficient Funds (Operational - should NOT go to Sentry)
echo "3. Testing insufficient funds..."
curl -X POST "$BASE_URL/accounts/test-456/withdraw" \
  -H "Content-Type: application/json" \
  -d '{"amount": 1000}' \
  -w "\nStatus: %{http_code}\n" \
  -s | jq .
echo ""

# Test 4: Check Metrics
echo "4. Checking Prometheus metrics..."
curl "$BASE_URL/admin/metrics" -s | grep "http_errors_total" | head -5
echo ""

echo "✅ Testing complete!"
echo "Check Sentry dashboard for non-operational errors"
echo "Check /admin/metrics for Prometheus metrics"
```

### 4.2 Run Test Script
```bash
chmod +x scripts/test-monitoring.sh
./scripts/test-monitoring.sh
```

---

## 🔍 Step 5: Verify Integration

### 5.1 Check Application Logs

Look for these log messages:

**Prometheus:**
```
[ErrorMetricsService] Prometheus metrics initialized
```

**Sentry:**
```
[ErrorTrackingService] Sentry error tracking initialized
```

**If not initialized:**
```
[ErrorMetricsService] Prometheus not available - metrics will be logged only
[ErrorTrackingService] Sentry not available - error tracking will use logger only
```

### 5.2 Test Correlation IDs

Every error response includes a correlation ID:
```bash
curl -v -X POST http://localhost:3000/accounts/test/deposit \
  -H "Content-Type: application/json" \
  -d '{"amount": -100}' 2>&1 | grep -i "x-correlation-id"
```

Response should include:
```
< X-Correlation-Id: 1733136600000-x7k2m9p4q
```

### 5.3 Test Metrics Endpoint

```bash
# If Prometheus is installed
curl http://localhost:3000/admin/metrics

# Should return Prometheus-formatted metrics or:
# {"message":"Metrics not available - Prometheus client not configured"}
```

---

## 🐛 Troubleshooting

### Prometheus Not Working

**Problem:** Metrics endpoint returns 503 or empty
- ✅ Check if `prom-client` is installed: `npm list prom-client`
- ✅ Check application logs for initialization message
- ✅ Verify errors are being triggered (check HTTP status codes)

### Sentry Not Working

**Problem:** No errors appearing in Sentry
- ✅ Check if `@sentry/node` is installed: `npm list @sentry/node`
- ✅ Verify `SENTRY_DSN` environment variable is set
- ✅ Check application logs for "Sentry error tracking initialized"
- ✅ Remember: Only non-operational errors are sent to Sentry
- ✅ Wait a few seconds for errors to appear in dashboard

### Correlation IDs Missing

**Problem:** No correlation ID in response headers
- ✅ Check if `CorrelationMiddleware` is registered in `AppModule`
- ✅ Verify middleware is applied to all routes
- ✅ Check `GlobalExceptionFilter` is using correlation ID

---

## 📊 Expected Behavior Summary

| Error Type | Sentry? | Prometheus? | HTTP Status |
|------------|---------|-------------|-------------|
| Validation Error | ❌ No | ✅ Yes | 400 |
| Not Found | ❌ No | ✅ Yes | 404 |
| Insufficient Funds | ❌ No | ✅ Yes | 422 |
| Internal Server Error | ✅ Yes | ✅ Yes | 500 |
| Database Error | ✅ Yes | ✅ Yes | 503 |
| Circuit Breaker Open | ✅ Yes | ✅ Yes | 503 |

---

## ✅ Success Checklist

- [ ] Prometheus metrics endpoint returns data (if `prom-client` installed)
- [ ] Error counts increase for each error type
- [ ] Sentry dashboard shows non-operational errors (if `@sentry/node` installed)
- [ ] Correlation IDs appear in response headers
- [ ] Correlation IDs match Sentry tags
- [ ] Operational errors are filtered out of Sentry
- [ ] Application logs show initialization messages
- [ ] Metrics show normalized paths (`/:id` instead of actual IDs)

---

## 🚀 Next Steps

1. Set up Prometheus server to scrape metrics from `/admin/metrics`
2. Create Grafana dashboards for error rates
3. Set up Sentry alerts for critical errors
4. Monitor correlation IDs across microservices
5. Add custom tags to Sentry for better grouping

