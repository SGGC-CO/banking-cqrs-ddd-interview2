import { CircuitBreakerError } from './circuit-breaker';

export interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier?: number; // Optional exponential backoff
  retryableErrors?: Array<new (...args: any[]) => Error>; // Which errors to retry
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const {
    maxAttempts,
    delayMs,
    backoffMultiplier = 1,
    retryableErrors = [CircuitBreakerError],
  } = options;

  let lastError: Error;
  let currentDelay = delayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if error is retryable
      const isRetryable = retryableErrors.some(
        (errorClass) => error instanceof errorClass
      );

      // Don't retry if not retryable or last attempt
      if (!isRetryable || attempt === maxAttempts) {
        throw error;
      }

      console.log(
        `[Retry] Attempt ${attempt}/${maxAttempts} failed: ${lastError.message}`
      );
      console.log(`[Retry] Waiting ${currentDelay}ms before retry...`);

      // Wait before next attempt
      await sleep(currentDelay);

      // Exponential backoff
      currentDelay = currentDelay * backoffMultiplier;
    }
  }

  throw lastError!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Decorator for automatic retry on methods
 */
export function Retry(options: RetryOptions) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      return retry(() => originalMethod.apply(this, args), options);
    };

    return descriptor;
  };
}
