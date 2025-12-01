import { Injectable } from '@nestjs/common';
import { ResilientCommandHandler } from '../../../../libs/resilience/resilient-handler';
import { Account } from '../../domain/aggregates/account.aggregate';
import { AccountEventRepository } from '../../domain/repositories/account-event.repository';
import { OpenAccountCommand } from '../commands/open-account.command';

@Injectable()
export class OpenAccountHandler extends ResilientCommandHandler<
  OpenAccountCommand,
  { accountId: string }
> {
  constructor(private readonly repo: AccountEventRepository) {
    super(); // No idempotency for OpenAccount (each gets unique ID)
  }

  protected async executeInternal(cmd: OpenAccountCommand) {
    const existing = await this.repo.getById(cmd.accountId);
    if (existing) throw new Error("Account already exists");

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
