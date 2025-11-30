export class DepositedEvent {
  constructor(
    public readonly accountId: string, 
    public readonly amount: number
  ) {}
}
