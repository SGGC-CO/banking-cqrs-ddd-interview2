import { Injectable, Inject } from "@nestjs/common";
import { randomUUID } from "crypto";
import { IdempotencyStore } from "../../../../libs/resilience/idempotency-redis";
import { ResilientCommandHandler } from "../../../../libs/resilience/resilient-handler";
import { AccountEventRepository } from "../../domain/repositories/account-event.repository";
import { WithdrawCommand } from "../commands/withdraw.command";

@Injectable()
export class WithdrawHandler extends ResilientCommandHandler<
  WithdrawCommand,
  { accountId: string }
> {
  constructor(
    private readonly repo: AccountEventRepository,
    @Inject("IDEMPOTENCY_STORE") idempotency: IdempotencyStore,
  ) {
    super(idempotency);
  }

  /**
   * Execute withdraw command
   */
  protected async executeInternal(cmd: WithdrawCommand) {
    const acc = await this.repo.getById(cmd.accountId);
    acc.withdraw(cmd.amount);
    await this.repo.save(acc);

    return { accountId: cmd.accountId };
  }

  /**
   * Always enable idempotency for withdraw operations
   */
  protected isIdempotent(cmd: WithdrawCommand): boolean {
    return true;
  }

  protected generateIdempotencyKey(cmd: WithdrawCommand): string {
    // If client provided an idempotency key, use it directly
    // This allows clients to prevent duplicate processing by using the same key,
    // while allowing legitimate duplicates by using different keys
    if (cmd.idempotencyKey) {
      return this.idempotency!.generateKey("withdraw", cmd.idempotencyKey);
    }

    // Fallback: Generate unique key per request (includes params + unique ID)
    // This ensures each request is processed while still enabling idempotency protection
    return this.generateFallbackIdempotencyKey(cmd);
  }

  protected generateFallbackIdempotencyKey(cmd: WithdrawCommand): string {
    // Generate unique key: operation + accountId + amount + unique request ID
    // This allows all legitimate requests through while preventing true duplicates
    const requestId = randomUUID();
    return this.idempotency!.generateKey(
      "withdraw",
      cmd.accountId,
      cmd.amount,
      requestId,
    );
  }
}
