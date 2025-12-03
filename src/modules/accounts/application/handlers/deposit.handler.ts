import { Injectable, Inject } from "@nestjs/common";
import { randomUUID } from "crypto";
import { IdempotencyStore } from "../../../../libs/resilience/idempotency-redis";
import { ResilientCommandHandler } from "../../../../libs/resilience/resilient-handler";
import { AccountEventRepository } from "../../domain/repositories/account-event.repository";
import { DepositCommand } from "../commands/deposit.command";

@Injectable()
export class DepositHandler extends ResilientCommandHandler<
  DepositCommand,
  { accountId: string }
> {
  constructor(
    private readonly repo: AccountEventRepository,
    @Inject("IDEMPOTENCY_STORE") idempotency: IdempotencyStore,
  ) {
    super(idempotency);
  }

  protected async executeInternal(cmd: DepositCommand) {
    const acc = await this.repo.getById(cmd.accountId);
    acc.deposit(cmd.amount);
    await this.repo.save(acc);

    return { accountId: cmd.accountId };
  }

  /**
   * Always enable idempotency for deposit operations
   */
  protected isIdempotent(cmd: DepositCommand): boolean {
    return true;
  }

  protected generateIdempotencyKey(cmd: DepositCommand): string {
    // If client provided an idempotency key, use it directly
    // This allows clients to prevent duplicate processing by using the same key,
    // while allowing legitimate duplicates by using different keys
    if (cmd.idempotencyKey) {
      return this.idempotency!.generateKey("deposit", cmd.idempotencyKey);
    }

    // Fallback: Generate unique key per request (includes params + unique ID)
    // This ensures each request is processed while still enabling idempotency protection
    return this.generateFallbackIdempotencyKey(cmd);
  }

  protected generateFallbackIdempotencyKey(cmd: DepositCommand): string {
    // Generate unique key: operation + accountId + amount + unique request ID
    // This allows all legitimate requests through while preventing true duplicates
    const requestId = randomUUID();
    return this.idempotency!.generateKey(
      "deposit",
      cmd.accountId,
      cmd.amount,
      requestId,
    );
  }
}
