import { Injectable, Logger } from "@nestjs/common";
import { ErrorEvent } from "./error-events";

/**
 * Represents the status of an error action
 */
export type ActionStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "retrying";

/**
 * Tracks execution status of a single error action
 */
export interface ErrorActionStatusRecord {
  id: string;
  eventId: string;
  eventType: string;
  handlerName: string;
  status: ActionStatus;
  startedAt: Date;
  completedAt?: Date;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  isCritical: boolean;
  correlationId?: string;
}

/**
 * Summary of error action statistics
 */
export interface ErrorActionStatistics {
  totalEvents: number;
  pendingCount: number;
  runningCount: number;
  successCount: number;
  failedCount: number;
  retriesCount: number;
  averageExecutionTimeMs: number;
  recentFailures: ErrorActionStatusRecord[];
  recentSuccesses: ErrorActionStatusRecord[];
}

/**
 * Service to track error action status and statistics
 * Uses Redis by default for persistent tracking across restarts
 * Falls back to in-memory if Redis unavailable
 * Inspired by IdempotencyStore pattern used in the project
 */
@Injectable()
export class ErrorActionStatusService {
  private readonly logger = new Logger(ErrorActionStatusService.name);

  // In-memory fallback storage
  private readonly statusMap = new Map<string, ErrorActionStatusRecord>();
  private readonly completedActions: ErrorActionStatusRecord[] = [];
  private readonly maxStoredActions = 1000; // Keep last 1000 in memory

  // Redis support
  private redis: any = null;
  private useRedis = false;
  private readonly REDIS_STATUS_KEY = "error_action:statuses";
  private readonly REDIS_COMPLETED_KEY = "error_action:completed";

  constructor(redis?: any) {
    if (redis) {
      this.redis = redis;
      this.useRedis = true;
      this.logger.log(
        "✅ Redis connected - error action status will be persisted",
      );
    } else {
      this.logger.warn(
        "⚠️  Redis not available - using in-memory status tracking (lost on restart)",
      );
    }
  }

  /**
   * Generate unique ID for tracking
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Record the start of an error action
   */
  markPending(
    event: ErrorEvent,
    handlerName: string,
    isCritical: boolean,
  ): string {
    const id = this.generateId();
    const eventId = (event as any).id || id;

    const record: ErrorActionStatusRecord = {
      id,
      eventId,
      eventType: event.constructor.name,
      handlerName,
      status: "pending",
      startedAt: new Date(),
      attempts: 0,
      maxAttempts: isCritical ? 3 : 1,
      isCritical,
      correlationId: event.context.correlationId,
    };

    // Store in-memory
    this.statusMap.set(id, record);

    // Store in Redis asynchronously (non-blocking)
    if (this.useRedis) {
      this.redis
        .hset(this.REDIS_STATUS_KEY, id, JSON.stringify(record))
        .catch((err: any) => {
          this.logger.error(
            "Failed to store status in Redis, falling back to in-memory",
            err,
          );
          this.useRedis = false;
        });
    }

    this.logger.debug(
      `Marked action as pending: ${handlerName} for ${event.constructor.name}`,
      { id, eventId },
    );

    return id;
  }

  /**
   * Mark action as running
   */
  markRunning(actionId: string): void {
    const record = this.statusMap.get(actionId);
    if (record) {
      record.status = "running";
      record.attempts++;
      this.updateRecord(record);
      this.logger.debug(
        `Action running: ${actionId} (attempt ${record.attempts})`,
      );
    }
  }

  /**
   * Mark action as successfully completed
   */
  markSuccess(actionId: string): void {
    const record = this.statusMap.get(actionId);
    if (record) {
      record.status = "success";
      record.completedAt = new Date();
      this.logger.log(
        `Action succeeded: ${record.handlerName} (${this.getDuration(
          record,
        )}ms)`,
      );
      this.archiveAction(record);
    }
  }

  /**
   * Mark action as failed (will retry if attempts < maxAttempts)
   */
  markFailed(actionId: string, error: Error): void {
    const record = this.statusMap.get(actionId);
    if (record) {
      record.lastError = error.message;

      if (record.attempts < record.maxAttempts) {
        record.status = "retrying";
        this.logger.warn(
          `Action failed, retrying: ${record.handlerName} (attempt ${record.attempts}/${record.maxAttempts})`,
          { error: error.message, actionId },
        );
      } else {
        record.status = "failed";
        record.completedAt = new Date();
        this.logger.error(
          `Action failed permanently: ${record.handlerName} after ${record.attempts} attempts`,
          { error: error.message, actionId },
        );
      }

      this.updateRecord(record);
    }
  }

  /**
   * Get current status of an action
   */
  getActionStatus(actionId: string): ErrorActionStatusRecord | undefined {
    return this.statusMap.get(actionId);
  }

  /**
   * Get all active (non-completed) actions
   */
  getActiveActions(): ErrorActionStatusRecord[] {
    return Array.from(this.statusMap.values());
  }

  /**
   * Get statistics about error actions
   */
  getStatistics(): ErrorActionStatistics {
    const active = this.getActiveActions();
    const allActions = [...active, ...this.completedActions];

    const stats: ErrorActionStatistics = {
      totalEvents: allActions.length,
      pendingCount: active.filter((a) => a.status === "pending").length,
      runningCount: active.filter((a) => a.status === "running").length,
      successCount: this.completedActions.filter((a) => a.status === "success")
        .length,
      failedCount: this.completedActions.filter((a) => a.status === "failed")
        .length,
      retriesCount: allActions.reduce((sum, a) => sum + (a.attempts - 1), 0),
      averageExecutionTimeMs:
        this.completedActions.length > 0
          ? Math.round(
              this.completedActions.reduce(
                (sum, a) => sum + this.getDuration(a),
                0,
              ) / this.completedActions.length,
            )
          : 0,
      recentFailures: this.completedActions
        .filter((a) => a.status === "failed")
        .slice(-5),
      recentSuccesses: this.completedActions
        .filter((a) => a.status === "success")
        .slice(-5),
    };

    return stats;
  }

  /**
   * Get critical actions that are pending or running
   */
  getCriticalPending(): ErrorActionStatusRecord[] {
    return this.getActiveActions().filter(
      (a) => a.isCritical && (a.status === "pending" || a.status === "running"),
    );
  }

  /**
   * Get failed critical actions
   */
  getCriticalFailures(): ErrorActionStatusRecord[] {
    return this.completedActions.filter(
      (a) => a.isCritical && a.status === "failed",
    );
  }

  /**
   * Update record in both stores
   */
  private updateRecord(record: ErrorActionStatusRecord): void {
    this.statusMap.set(record.id, record);

    if (this.useRedis) {
      this.redis
        .hset(this.REDIS_STATUS_KEY, record.id, JSON.stringify(record))
        .catch((err: any) => {
          this.logger.error(
            "Failed to update status in Redis, falling back to in-memory",
            err,
          );
          this.useRedis = false;
        });
    }
  }

  /**
   * Archive completed action (move from active to completed)
   */
  private archiveAction(record: ErrorActionStatusRecord): void {
    this.completedActions.push(record);

    // Keep only last N actions in memory
    if (this.completedActions.length > this.maxStoredActions) {
      this.completedActions.shift();
    }

    // Remove from active
    this.statusMap.delete(record.id);

    // Archive in Redis (move from active to completed)
    if (this.useRedis) {
      // Remove from active set
      this.redis.hdel(this.REDIS_STATUS_KEY, record.id).catch(() => {
        // Ignore errors
      });

      // Add to completed list (for audit trail)
      this.redis
        .rpush(this.REDIS_COMPLETED_KEY, JSON.stringify(record))
        .catch((err: any) => {
          this.logger.error("Failed to archive to Redis", err);
          this.useRedis = false;
        });
    }
  }

  /**
   * Get execution duration in milliseconds
   */
  private getDuration(record: ErrorActionStatusRecord): number {
    const endTime = record.completedAt || new Date();
    return endTime.getTime() - record.startedAt.getTime();
  }

  /**
   * Reset all statistics (for testing)
   */
  reset(): void {
    this.statusMap.clear();
    this.completedActions.length = 0;

    if (this.useRedis) {
      this.redis
        .del(this.REDIS_STATUS_KEY, this.REDIS_COMPLETED_KEY)
        .catch((err: any) => {
          this.logger.error("Failed to reset Redis data", err);
        });
    }

    this.logger.log("Error action status service reset");
  }

  /**
   * Get formatted summary for logging
   */
  getSummary(): string {
    const stats = this.getStatistics();
    const storage = this.useRedis ? "Redis" : "In-Memory";
    return (
      `[${storage}] Error Actions Summary: ` +
      `Total=${stats.totalEvents}, ` +
      `Success=${stats.successCount}, ` +
      `Failed=${stats.failedCount}, ` +
      `Pending=${stats.pendingCount}, ` +
      `Running=${stats.runningCount}, ` +
      `AvgTime=${stats.averageExecutionTimeMs}ms`
    );
  }
}
