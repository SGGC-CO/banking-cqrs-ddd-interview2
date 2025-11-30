export class WithdrawnEvent {
  constructor(
    public readonly accountId: string, 
    public readonly amount: number
  ) {}
}
