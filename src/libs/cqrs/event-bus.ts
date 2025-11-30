import { Injectable } from '@nestjs/common';

export type EventHandler<E = any> = (event: E) => Promise<void> | void;

@Injectable()
export class EventBus {
  private handlers = new Map<string, EventHandler[]>();

  subscribe(eventName: string, handler: EventHandler) {
    const list = this.handlers.get(eventName) || [];
    list.push(handler);
    this.handlers.set(eventName, list);
  }

  async publish(event: any) {
    const name = event.constructor.name;
    const list = this.handlers.get(name) || [];
    for (const h of list) await h(event);
  }
}
