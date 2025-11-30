import { createHash } from 'crypto';

/**
 * Simple in-memory idempotency store
 * In production, use Redis or database
 */
export class IdempotencyStore {
  private store = new Map<string, { result: any; expiresAt: number }>();

  /**
   * Get cached result if exists and not expired
   */
  async get(key: string): Promise<any | null> {
    const record = this.store.get(key);
    if (!record) return null;

    if (Date.now() > record.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return record.result;
  }

  /**
   * Store result with TTL in seconds
   */
  async set(key: string, result: any, ttlSeconds: number): Promise<void> {
    this.store.set(key, {
      result,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  /**
   * Generate idempotency key from request data
   */
  generateKey(namespace: string, ...values: any[]): string {
    const data = JSON.stringify({ namespace, values });
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Clear expired entries (call periodically)
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      if (now > record.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}
