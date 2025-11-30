export abstract class AggregateRoot {
  private _version = 0;
  private _id: string;
  private _pending: any[] = [];

  get id() { return this._id; }
  protected setId(id: string) { this._id = id; }

  get version() { return this._version; }
  protected setVersion(v: number) { this._version = v; }

  protected apply(event: any) {
    const handler = (this as any)[`on${event.constructor.name}`];
    if (handler) handler.call(this, event);
    this._pending.push(event);
    this._version += 1;
  }

  pullUncommittedEvents() {
    const e = [...this._pending];
    this._pending = [];
    return e;
  }

  /**
   * Restore uncommitted events (used when persistence fails and needs retry)
   */
  restoreUncommittedEvents(events: any[]) {
    this._pending = [...events, ...this._pending];
    this._version -= events.length;
  }

  /**
   * Load aggregate from history
   * INCOMPLETE - TO BE IMPLEMENTED BY INTERVIEWEE
   */
  static rehydrate(events: any[]): any {
    // TODO: Implement aggregate rehydration from event history
    throw new Error('Method not implemented');
  }
}
