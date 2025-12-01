import { CircuitBreakerError } from './circuit-breaker';
import { IdempotencyStore } from './idempotency-redis';
import { retry, RetryOptions } from './retry';
import { randomUUID } from "crypto";

/**
 * Base handler with built-in idempotency and retry logic
 * Extend this class to automatically get resilience features
 */
export abstract class ResilientCommandHandler<TCommand, TResult> {
  protected readonly retryOptions: RetryOptions = {
    maxAttempts: 3,
    delayMs: 2000,
    backoffMultiplier: 2,
    retryableErrors: [], // Don't retry CircuitBreakerError - fail fast when circuit is OPEN
  };

  constructor(protected readonly idempotency?: IdempotencyStore) {
    // Cleanup expired idempotency records every 5 minutes (only for in-memory)
    if (idempotency?.cleanup) {
      setInterval(() => idempotency.cleanup!(), 5 * 60 * 1000);
    }
  }

  /**
   * Execute command with automatic idempotency and retry
   */
  async execute(cmd: TCommand): Promise<TResult> {
    // If idempotency is enabled and command is idempotent, check cache first
    if (this.idempotency && this.isIdempotent(cmd)) {
      const idempotencyKey = this.generateIdempotencyKey(cmd);

      const cachedResult = await this.idempotency.get(idempotencyKey);
      if (cachedResult) {
        console.log(
          `[${this.constructor.name}] Duplicate request detected, returning cached result`,
        );
        return cachedResult;
      }

      // Execute with retry
      const result = await retry(
        () => this.executeInternal(cmd),
        this.retryOptions,
      );

      // Cache the result
      await this.idempotency.set(idempotencyKey, result, this.getCacheTTL());

      return result;
    }

    // No idempotency, just execute with retry
    return retry(() => this.executeInternal(cmd), this.retryOptions);
  }

  /**
   * Generate a fallback idempotency key when client doesn't provide one.
   * Override this in handlers to customize fallback key generation.
   * Default implementation generates a unique key per request.
   */
  protected generateFallbackIdempotencyKey(cmd: TCommand): string {
    // Generate unique key per request to avoid blocking legitimate duplicates
    // This ensures each request gets processed while still enabling idempotency checks
    return randomUUID();
  }

  /**
   * Override this to implement the actual command logic
   */
  protected abstract executeInternal(cmd: TCommand): Promise<TResult>;

  /**
   * Override this to customize idempotency key generation
   */
  protected abstract generateIdempotencyKey(cmd: TCommand): string;

  /**
   * Override to disable idempotency for specific handlers or commands
   * @param cmd - The command being executed
   */
  protected isIdempotent(cmd: TCommand): boolean {
    return true;
  }

  /**
   * Override to customize cache TTL (default: 60 seconds)
   */
  protected getCacheTTL(): number {
    return 60;
  }

  /**
   * Override to customize retry options for specific handlers
   */
  protected getRetryOptions(): RetryOptions {
    return this.retryOptions;
  }
}

/**
 * Helper to generate idempotency keys
 */
export function generateIdempotencyKey(
  store: IdempotencyStore,
  operation: string,
  ...values: any[]
): string {
  return store.generateKey(operation, ...values);
}
