import { Injectable } from '@nestjs/common';
import { IdempotencyStore } from '../../../../libs/resilience/idempotency-redis';
import { ResilientCommandHandler } from '../../../../libs/resilience/resilient-handler';
import { AccountEventRepository } from '../../domain/repositories/account-event.repository';
import { DepositCommand } from '../commands/deposit.command';

@Injectable()
export class DepositHandler extends ResilientCommandHandler<
  DepositCommand,
  { accountId: string }
> {
  constructor(
    private readonly repo: AccountEventRepository,
    idempotency: IdempotencyStore
  ) {
    super(idempotency);
  }

  protected async executeInternal(cmd: DepositCommand) {
    const acc = await this.repo.getById(cmd.accountId);
    if (!acc) throw new Error('Account not found');

    acc.deposit(cmd.amount);
    await this.repo.save(acc);

    return { accountId: cmd.accountId };
  }

  protected generateIdempotencyKey(cmd: DepositCommand): string {
    return this.idempotency!.generateKey('deposit', cmd.accountId, cmd.amount);
  }
}
