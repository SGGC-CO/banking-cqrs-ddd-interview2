import { Injectable } from '@nestjs/common';
import { Query } from './query';

type QueryHandler<T extends Query, R = any> = {
  execute(query: T): Promise<R> | R;
};

@Injectable()
export class QueryBus {
  private handlers = new Map<string, QueryHandler<Query>>();

  register(queryName: string, handler: QueryHandler<Query>) {
    this.handlers.set(queryName, handler as any);
  }

  async execute<T extends Query, R = any>(query: T): Promise<R> {
    const handler = this.handlers.get(query.constructor.name);
    if (!handler) throw new Error(`No handler for ${query.constructor.name}`);
    return handler.execute(query);
  }
}
