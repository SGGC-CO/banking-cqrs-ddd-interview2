import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'async_hooks';

export const correlationStorage = new AsyncLocalStorage<string>();

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const correlationId = req.headers['x-correlation-id'] as string
      || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Set on request for easy access
    (req as any).correlationId = correlationId;
    (req as any).startTime = Date.now();

    // Set response header
    res.setHeader('X-Correlation-Id', correlationId);

    // Run rest of request in async context
    correlationStorage.run(correlationId, () => {
      next();
    });
  }
}

// Helper to get current correlation ID
export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore();
}

