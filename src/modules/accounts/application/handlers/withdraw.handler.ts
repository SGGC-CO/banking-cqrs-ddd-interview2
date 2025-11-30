import { Injectable } from '@nestjs/common';
import { IdempotencyStore } from '../../../../libs/resilience/idempotency-redis';
import { ResilientCommandHandler } from '../../../../libs/resilience/resilient-handler';
import { AccountEventRepository } from '../../domain/repositories/account-event.repository';
import { WithdrawCommand } from '../commands/withdraw.command';

@Injectable()
export class WithdrawHandler extends ResilientCommandHandler<
  WithdrawCommand,
  { accountId: string }
> {
  constructor(
    private readonly repo: AccountEventRepository,
    idempotency: IdempotencyStore
  ) {
    super(idempotency);
  }

  /**
   * Execute withdraw command
   * INCOMPLETE - TO BE IMPLEMENTED BY INTERVIEWEE
   */
  protected async executeInternal(cmd: WithdrawCommand) {
    const acc = await this.repo.getById(cmd.accountId);
    if (!acc) throw new Error('Account not found');

    acc.withdraw(cmd.amount);
    await this.repo.save(acc);

    return { accountId: cmd.accountId };
  }

  protected generateIdempotencyKey(cmd: WithdrawCommand): string {
    return this.idempotency!.generateKey('withdraw', cmd.accountId, cmd.amount);
  }
}
