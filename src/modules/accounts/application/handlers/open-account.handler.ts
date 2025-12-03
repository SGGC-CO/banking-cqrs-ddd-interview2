import { Injectable } from '@nestjs/common';
import {
  AccountAlreadyExistsError,
  AccountNotFoundError,
} from "../../../../libs/exceptions/domain.exceptions";
import { ResilientCommandHandler } from "../../../../libs/resilience/resilient-handler";
import { Account } from "../../domain/aggregates/account.aggregate";
import { AccountEventRepository } from "../../domain/repositories/account-event.repository";
import { OpenAccountCommand } from "../commands/open-account.command";

@Injectable()
export class OpenAccountHandler extends ResilientCommandHandler<
  OpenAccountCommand,
  { accountId: string }
> {
  constructor(private readonly repo: AccountEventRepository) {
    super(); // No idempotency for OpenAccount (each gets unique ID)
  }

  protected async executeInternal(cmd: OpenAccountCommand) {
    // Check if account already exists
    try {
      await this.repo.getById(cmd.accountId);
      // If no exception, account exists
      throw new AccountAlreadyExistsError(cmd.accountId);
    } catch (error) {
      // If AccountNotFoundError, account doesn't exist - this is what we want
      if (error instanceof AccountNotFoundError) {
        // Continue to create account
      } else {
        // Re-throw other errors (AccountAlreadyExistsError, CircuitBreakerError, etc.)
        throw error;
      }
    }

    const agg = Account.open(
      cmd.accountId,
      cmd.ownerId,
      cmd.currency,
      cmd.initialBalance,
    );
    await this.repo.save(agg);

    return { accountId: cmd.accountId };
  }

  protected generateIdempotencyKey(cmd: OpenAccountCommand): string {
    // Not used since isIdempotent() returns false
    return "";
  }

  protected isIdempotent(cmd: OpenAccountCommand): boolean {
    // OpenAccount is not idempotent because each request gets a unique UUID
    return false;
  }
}
