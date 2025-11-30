# Redis Idempotency Setup Guide

## Installation

### 1. Install Redis Client

```bash
npm install ioredis
npm install @types/ioredis --save-dev
```

### 2. Install and Run Redis Server

#### Option A: Using Docker (Recommended)

```bash
# Start Redis in Docker
docker run -d \
  --name banking-redis \
  -p 6379:6379 \
  redis:7-alpine

# Verify it's running
docker ps | grep redis
```

#### Option B: Using Homebrew (macOS)

```bash
# Install Redis
brew install redis

# Start Redis
brew services start redis

# Verify
redis-cli ping
# Should return: PONG
```

#### Option C: Using APT (Ubuntu/Debian)

```bash
# Install Redis
sudo apt update
sudo apt install redis-server

# Start Redis
sudo systemctl start redis

# Verify
redis-cli ping
```

---

## Environment Configuration

### Create `.env` file

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# MongoDB Configuration (existing)
MONGO_URL=mongodb://localhost:27017
MONGO_DB=banking_cqrs
```

### Load Environment Variables

Update `src/main.ts` if needed:

```typescript
import * as dotenv from 'dotenv';
dotenv.config();
```

---

## How It Works

### Automatic Fallback

The system automatically detects if Redis is available:

```typescript
// If Redis is running:
[Redis] Connected successfully
[IdempotencyStore] Using Redis (production mode)

// If Redis is NOT available:
[Redis] Not available, will use in-memory store: ...
[IdempotencyStore] Using in-memory (development mode - NOT for production!)
```

### Without Redis (Development)

```bash
# Just start your app - works out of the box
npm run start:dev

# Idempotency works within a single instance
# WARNING: Not shared across multiple instances!
```

### With Redis (Production)

```bash
# Start Redis
docker start banking-redis

# Start your app
npm run start:dev

# Idempotency works across all instances!
```

---

## Testing Redis Integration

### Test 1: Verify Connection

```bash
# Terminal 1: Start your app
npm run start:dev

# Check logs for:
[Redis] Connected successfully
[IdempotencyStore] Using Redis (production mode)
```

### Test 2: Test Idempotency

```bash
# Terminal 2: Make a deposit
curl -X POST http://localhost:3000/accounts/test-123/deposit \
  -H "Content-Type: application/json" \
  -d '{"amount": 100}'

# Immediately make the same request again
curl -X POST http://localhost:3000/accounts/test-123/deposit \
  -H "Content-Type: application/json" \
  -d '{"amount": 100}'

# Should see in logs:
[DepositHandler] Duplicate request detected for account test-123, returning cached result
```

### Test 3: Inspect Redis Keys

```bash
# Connect to Redis CLI
docker exec -it banking-redis redis-cli

# List all idempotency keys
KEYS idempotency:*

# Get a specific key
GET idempotency:<hash>

# Check TTL (time to live)
TTL idempotency:<hash>
# Returns seconds until expiration (60 seconds)

# Monitor all commands in real-time
MONITOR
```

### Test 4: Multi-Instance Test

```bash
# Terminal 1: Start instance 1 on port 3000
PORT=3000 npm run start:dev

# Terminal 2: Start instance 2 on port 3001
PORT=3001 npm run start:dev

# Terminal 3: Make request to instance 1
curl -X POST http://localhost:3000/accounts/abc/deposit \
  -d '{"amount": 100}'

# Terminal 4: Make same request to instance 2
curl -X POST http://localhost:3001/accounts/abc/deposit \
  -d '{"amount": 100}'

# Second request should be cached!
# Both instances share the same Redis cache
```

---

## Monitoring

### Check Redis Stats

```bash
# Connect to Redis
docker exec -it banking-redis redis-cli

# Get info
INFO stats

# Check memory usage
INFO memory

# See all keys and their expiration
SCAN 0 MATCH idempotency:* COUNT 100
```

### Key Naming Convention

All idempotency keys follow this pattern:

```
idempotency:<hash>

Where <hash> = SHA256(operation + accountId + amount)

Examples:
idempotency:a1b2c3d4e5f6...  (deposit operation)
idempotency:f6e5d4c3b2a1...  (withdraw operation)
```

---

## Production Deployment

### Docker Compose

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - MONGO_URL=mongodb://mongo:27017
    depends_on:
      - redis
      - mongo
    deploy:
      replicas: 3  # Multiple instances!

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes  # Persistence

  mongo:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db

volumes:
  redis-data:
  mongo-data:
```

### Start with Docker Compose

```bash
docker-compose up -d

# Scale to 5 instances
docker-compose up -d --scale app=5
```

---

## Troubleshooting

### Issue: "Cannot find module 'ioredis'"

```bash
# Install Redis client
npm install ioredis @types/ioredis
```

### Issue: App uses in-memory instead of Redis

```bash
# Check Redis is running
docker ps | grep redis

# Check connection
redis-cli ping

# Check environment variables
echo $REDIS_HOST
echo $REDIS_PORT

# Check app logs for connection errors
```

### Issue: Keys not expiring

```bash
# Redis CLI
TTL idempotency:<key>

# If returns -1, key has no expiration (bug)
# If returns number, that's seconds until expiration
```

### Issue: High memory usage

```bash
# Check number of keys
redis-cli DBSIZE

# Clear all idempotency keys (CAREFUL!)
redis-cli --scan --pattern "idempotency:*" | xargs redis-cli DEL

# Or clear entire database (VERY CAREFUL!)
redis-cli FLUSHDB
```

---

## Performance Benchmarks

### In-Memory
```
Latency: < 0.1ms
Throughput: 100,000+ ops/sec
Shared: No
Persistent: No
```

### Redis (Local)
```
Latency: ~1ms
Throughput: 50,000+ ops/sec
Shared: Yes
Persistent: Yes
```

### Redis (Remote)
```
Latency: 1-5ms (depending on network)
Throughput: 10,000+ ops/sec
Shared: Yes
Persistent: Yes
```

---

## Cost Estimation

### Self-Hosted (Docker)
```
Cost: $0
Effort: Medium
Maintenance: You manage
```

### AWS ElastiCache
```
Cost: ~$15-30/month (t3.micro)
Effort: Low
Maintenance: AWS manages
```

### Redis Cloud
```
Cost: ~$5-20/month
Effort: Low
Maintenance: Redis manages
```

---

## Migration Checklist

- [ ] Install `ioredis` package
- [ ] Start Redis server (Docker/local/cloud)
- [ ] Configure `REDIS_HOST` and `REDIS_PORT` in `.env`
- [ ] Test single instance works
- [ ] Test duplicate detection works
- [ ] Test multi-instance (if applicable)
- [ ] Monitor Redis in production
- [ ] Set up Redis backup/persistence
- [ ] Configure Redis password (production)
- [ ] Set up monitoring/alerts

---

## Next Steps

1. **Development**: Works with in-memory (no Redis needed)
2. **Staging**: Install Redis, test multi-instance
3. **Production**: Use managed Redis (ElastiCache/Redis Cloud)
4. **Monitoring**: Set up Redis metrics and alerts
