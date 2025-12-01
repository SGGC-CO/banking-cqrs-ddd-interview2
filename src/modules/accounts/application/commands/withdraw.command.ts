import { Command } from '../../../../libs/cqrs/command';

export class WithdrawCommand extends Command {
  constructor(
    public readonly accountId: string,
    public readonly amount: number,
    public readonly idempotencyKey?: string,
  ) {
    super();
  }
}
