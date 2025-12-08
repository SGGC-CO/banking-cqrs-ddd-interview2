/**
 * Error Action Handler Interface
 * Implement this for error types that need custom actions
 */
import { ErrorEvent } from "./error-events";

export interface ErrorActionHandler {
  /**
   * Handle the error event
   * @param event The error event
   */
  handle(event: ErrorEvent): Promise<void>;

  /**
   * Check if this handler can handle the given error event
   * @param event The error event
   * @returns true if this handler should handle the event
   */
  canHandle(event: ErrorEvent): boolean;
}
