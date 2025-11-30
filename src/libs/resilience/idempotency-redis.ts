import { createHash } from 'crypto';

export interface IdempotencyStore {
  get(key: string): Promise<any | null>;
  set(key: string, result: any, ttlSeconds: number): Promise<void>;
  generateKey(namespace: string, ...values: any[]): string;
  cleanup?(): void;
}

/**
 * Redis-based idempotency store (Production)
 * Shared across all app instances
 */
export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(private readonly redis: any) {} // 'any' to avoid ioredis type dependency

  async get(key: string): Promise<any | null> {
    try {
      const value = await this.redis.get(`idempotency:${key}`);
      if (!value) return null;
      return JSON.parse(value);
    } catch (error) {
      console.error(`[RedisIdempotencyStore] Error getting key ${key}:`, error);
      return null; // Fail open - don't block requests
    }
  }

  async set(key: string, result: any, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.setex(
        `idempotency:${key}`,
        ttlSeconds,
        JSON.stringify(result)
      );
    } catch (error) {
      console.error(`[RedisIdempotencyStore] Error setting key ${key}:`, error);
      // Don't throw - failing to cache shouldn't break the request
    }
  }

  generateKey(namespace: string, ...values: any[]): string {
    const data = JSON.stringify({ namespace, values });
    return createHash('sha256').update(data).digest('hex');
  }
}

/**
 * In-memory idempotency store (Development/Testing)
 * WARNING: Not shared across instances, lost on restart
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private store = new Map<string, { result: any; expiresAt: number }>();

  async get(key: string): Promise<any | null> {
    const record = this.store.get(key);
    if (!record) return null;

    if (Date.now() > record.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return record.result;
  }

  async set(key: string, result: any, ttlSeconds: number): Promise<void> {
    this.store.set(key, {
      result,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  generateKey(namespace: string, ...values: any[]): string {
    const data = JSON.stringify({ namespace, values });
    return createHash('sha256').update(data).digest('hex');
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      if (now > record.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

/**
 * Hybrid idempotency store (Best Performance)
 * L1 cache: In-memory (same instance)
 * L2 cache: Redis (cross-instance)
 */
export class HybridIdempotencyStore implements IdempotencyStore {
  private localCache = new Map<string, { result: any; expiresAt: number }>();
  private localCacheTTL = 30; // Keep in local cache for 30 seconds

  constructor(private readonly redis: any) {
    // Cleanup local cache every minute
    setInterval(() => this.cleanupLocalCache(), 60 * 1000);
  }

  async get(key: string): Promise<any | null> {
    // L1: Check local cache first (microseconds)
    const local = this.localCache.get(key);
    if (local && Date.now() <= local.expiresAt) {
      console.log(`[HybridIdempotencyStore] L1 cache HIT: ${key}`);
      return local.result;
    }

    // L2: Check Redis (milliseconds)
    try {
      const value = await this.redis.get(`idempotency:${key}`);
      if (value) {
        console.log(`[HybridIdempotencyStore] L2 (Redis) cache HIT: ${key}`);
        const result = JSON.parse(value);
        
        // Warm local cache
        this.localCache.set(key, {
          result,
          expiresAt: Date.now() + this.localCacheTTL * 1000,
        });
        
        return result;
      }
    } catch (error) {
      console.error(`[HybridIdempotencyStore] Redis error:`, error);
    }

    return null;
  }

  async set(key: string, result: any, ttlSeconds: number): Promise<void> {
    // Store in local cache
    this.localCache.set(key, {
      result,
      expiresAt: Date.now() + this.localCacheTTL * 1000,
    });

    // Store in Redis
    try {
      await this.redis.setex(
        `idempotency:${key}`,
        ttlSeconds,
        JSON.stringify(result)
      );
    } catch (error) {
      console.error(`[HybridIdempotencyStore] Redis error:`, error);
    }
  }

  generateKey(namespace: string, ...values: any[]): string {
    const data = JSON.stringify({ namespace, values });
    return createHash('sha256').update(data).digest('hex');
  }

  private cleanupLocalCache(): void {
    const now = Date.now();
    for (const [key, record] of this.localCache.entries()) {
      if (now > record.expiresAt) {
        this.localCache.delete(key);
      }
    }
  }
}
