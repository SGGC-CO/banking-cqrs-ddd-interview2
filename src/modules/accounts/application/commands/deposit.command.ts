import { Command } from '../../../../libs/cqrs/command';

export class DepositCommand extends Command {
  constructor(
    public readonly accountId: string, 
    public readonly amount: number
  ) { super(); }
}
