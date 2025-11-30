export class AccountOpenedEvent {
  constructor(
    public readonly accountId: string,
    public readonly ownerId: string,
    public readonly currency: string,
    public readonly balance: number
  ) {}
}
