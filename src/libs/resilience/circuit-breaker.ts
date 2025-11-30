/**
 * Circuit Breaker Pattern Implementation
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Too many failures, requests fail immediately
 * - HALF_OPEN: Testing if service recovered, limited requests allowed
 */

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  failureThreshold: number; // Number of failures before opening circuit
  successThreshold: number; // Number of successes in HALF_OPEN to close circuit
  timeout: number; // Time in ms before attempting to close circuit
  name?: string; // Name for logging purposes
}

export class CircuitBreakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private nextAttemptTime = 0;
  private readonly name: string;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.name = options.name || 'CircuitBreaker';
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        const error = new CircuitBreakerError(
          `[${this.name}] Circuit breaker is OPEN. Service unavailable.`
        );
        console.error(error.message);
        throw error;
      }
      // Timeout expired, move to HALF_OPEN
      this.state = CircuitState.HALF_OPEN;
      this.successCount = 0;
      console.log(`[${this.name}] Circuit breaker moving to HALF_OPEN state`);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      console.log(
        `[${this.name}] Success in HALF_OPEN (${this.successCount}/${this.options.successThreshold})`
      );

      if (this.successCount >= this.options.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
        console.log(`[${this.name}] Circuit breaker CLOSED - service recovered`);
      }
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    this.failureCount++;
    console.error(
      `[${this.name}] Failure detected (${this.failureCount}/${this.options.failureThreshold})`
    );

    if (
      this.state === CircuitState.HALF_OPEN ||
      this.failureCount >= this.options.failureThreshold
    ) {
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.options.timeout;
      console.error(
        `[${this.name}] Circuit breaker OPEN - will retry in ${this.options.timeout}ms`
      );
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit breaker metrics
   */
  getMetrics() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      nextAttemptTime: this.nextAttemptTime,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptTime = 0;
    console.log(`[${this.name}] Circuit breaker manually reset`);
  }
}
