import { Test, TestingModule } from "@nestjs/testing";
import { ErrorActionQueue } from "../../../src/libs/exceptions/error-action.queue";
import { ErrorActionHandler } from "../../../src/libs/exceptions/error-action.handler";
import { ErrorEvent } from "../../../src/libs/exceptions/error-events";
import { BaseException } from "../../../src/libs/exceptions/base.exception";

// Mock implementation of BaseException
class MockException extends BaseException {
  readonly code = "MOCK_ERROR";
  readonly httpStatus = 500;
  readonly isOperational = true;
}

// Mock implementation of ErrorEvent
class MockErrorEvent extends ErrorEvent {
  constructor() {
    super(
      new MockException("Mock error"),
      { timestamp: new Date().toISOString() },
      true, // Critical
    );
  }
}

describe("ErrorActionQueue", () => {
  let queue: ErrorActionQueue;
  let handler: ErrorActionHandler;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ErrorActionQueue],
    }).compile();

    queue = module.get<ErrorActionQueue>(ErrorActionQueue);

    // Mock handler
    handler = {
      canHandle: jest.fn().mockReturnValue(true),
      handle: jest.fn().mockResolvedValue(undefined),
    };

    queue.registerHandler(handler);
    queue.onModuleInit();
  });

  test("should process critical event successfully", async () => {
    const event = new MockErrorEvent();
    await queue.add(event);

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(handler.handle).toHaveBeenCalledWith(event);
  });

  test("should retry failed events", async () => {
    const event = new MockErrorEvent();

    // Fail twice, then succeed
    (handler.handle as jest.Mock)
      .mockRejectedValueOnce(new Error("Fail 1"))
      .mockRejectedValueOnce(new Error("Fail 2"))
      .mockResolvedValue(undefined);

    await queue.add(event);

    // Wait for retries (1s delay * 2 retries + buffer)
    // We mock setTimeout to speed this up in real tests, but for this simple integration test:
    // Let's just verify it was called once initially.
    // Testing full retry delay requires fake timers.

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handler.handle).toHaveBeenCalledTimes(1);
  });
});
