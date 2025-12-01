export abstract class AggregateRoot {
  private _version = 0;
  private _id: string;
  private _pending: any[] = [];

  get id() {
    return this._id;
  }
  protected setId(id: string) {
    this._id = id;
  }

  get version() {
    return this._version;
  }
  protected setVersion(v: number) {
    this._version = v;
  }

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
   * Load aggregate from history (generic implementation for all aggregates)
   * This is an internal helper method - aggregates should provide their own static rehydrate() method
   * @param AggregateClass - The aggregate class constructor (e.g., Account)
   * @param storedEvents - Array of stored events from event store (with payload property)
   * @returns Rehydrated aggregate instance
   */
  static rehydrateAggregate<T extends AggregateRoot>(
    AggregateClass: new () => T,
    storedEvents: any[],
  ): T {
    if (!storedEvents || storedEvents.length === 0) {
      throw new Error("Cannot rehydrate aggregate from empty event history");
    }

    // Create new instance of the aggregate
    const aggregate = new AggregateClass();

    // Apply each event to rebuild the aggregate state
    for (const storedEvent of storedEvents) {
      // If storedEvent has a 'type' field, it's from the database (StoredEvent format)
      // Otherwise, it's already an event instance (for restoreUncommittedEvents)
      let event = storedEvent.payload || storedEvent;
      let eventTypeName: string;

      if (storedEvent.type && typeof storedEvent.type === "string") {
        // This is a StoredEvent from database - use the type field
        eventTypeName = storedEvent.type;
        // Use the payload directly as the event data (it's a plain object from MongoDB)
        event = storedEvent.payload;
      } else {
        // This is already an event instance
        eventTypeName = event.constructor?.name || "Object";
      }

      // Find and call the event handler method (e.g., onAccountOpenedEvent)
      const handler = (aggregate as any)[`on${eventTypeName}`];
      if (handler) {
        handler.call(aggregate, event);
      } else {
        console.warn(
          `No handler found for event: ${eventTypeName} in aggregate ${AggregateClass.name}`,
        );
      }

      // Increment version for each applied event
      aggregate.setVersion(aggregate.version + 1);
    }

    return aggregate;
  }
}
