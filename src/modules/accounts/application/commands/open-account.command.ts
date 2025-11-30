import { Command } from '../../../../libs/cqrs/command';

export class OpenAccountCommand extends Command {
  constructor(
    public readonly accountId: string,
    public readonly ownerId: string,
    public readonly currency: string,
    public readonly initialBalance: number
  ) { super(); }
}
